import type { Server, Socket } from "socket.io";
import type {
  GameStats,
  Lane,
  LevelEvent,
  MovementDirection,
  PlayerInfo,
  PlayerRole,
} from "./types";

interface ActiveEntity {
  id: string;
  lane: Lane;
  spawnedAt: number;
  type: "MONSTER" | "OBSTACLE";
  forRole?: PlayerRole | "ALL";
}

interface InternalState {
  players: Map<string, PlayerInfo>;
  roundActive: boolean;
  roundNumber: number;
  monsters: Map<string, ActiveEntity>;
  obstacles: Map<string, ActiveEntity>;
  timers: Set<NodeJS.Timeout>;
  levelScript: LevelEvent[];
  roundStartTs: number | null;
  tideOffset: number;
  tideActiveUntil: number;
  tideCooldownUntil: number;
  tideDurationMs: number;
  tideCooldownMs: number;
  controllersByRole: Map<PlayerRole, string>; 
  controllerRoleBySocket: Map<string, PlayerRole>;
  lives?: number;
  lossProcessedIds?: Set<string>;
}

const LANES: Lane[] = ["LEFT", "CENTER", "RIGHT"];
const pickLane = (index: number): Lane => {
  const i = ((index % LANES.length) + LANES.length) % LANES.length;
  return LANES[i] as Lane;
};

export class GameManager {
  private io: Server;
  private state: InternalState;
  private travelMs = 2200;

  constructor(io: Server) {
    this.io = io;
    this.state = {
      players: new Map(),
      roundActive: false,
      roundNumber: 0,
      monsters: new Map(),
      obstacles: new Map(),
      timers: new Set(),
      levelScript: [],
      roundStartTs: null,
      tideOffset: 0,
      tideActiveUntil: 0,
      tideCooldownUntil: 0,
      tideDurationMs: 2000,
      tideCooldownMs: 5000,
      controllersByRole: new Map(),
      controllerRoleBySocket: new Map(),
      lives: 3,
      lossProcessedIds: new Set(),
    };
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    this.io.on("connection", (socket: Socket) => {
      console.log(`player connected ${socket.id}`);

      socket.emit("players-updated", this.serializePlayers());

      socket.on("join", (role: PlayerRole | "AUTO" | null | undefined) => {
        this.addPlayer(socket, role);
      });
      socket.on("pair-controller", (role: PlayerRole) => {
        this.pairController(socket, role);
      });

      socket.on("movement", (movement: MovementDirection) => {
        this.updateMovement(socket.id, movement);
      });

      socket.on("shoot", (lane: Lane) => {
        this.handleShoot(socket.id, lane);
      });

      socket.on("tide-shift", (direction: "LEFT" | "RIGHT") => {
        this.activateTide(socket.id, direction);
      });

      socket.on("start-round", () => {
        this.handleStartRound(socket.id);
      });

      socket.on("disconnect", () => {
        const ctrlRole = this.state.controllerRoleBySocket.get(socket.id);
        if (ctrlRole) {
          this.state.controllerRoleBySocket.delete(socket.id);
          const existing = this.state.controllersByRole.get(ctrlRole);
          if (existing === socket.id) this.state.controllersByRole.delete(ctrlRole);
          this.emitControllersState();
          return;
        }
        this.removePlayer(socket.id);
      });

      socket.emit("lives-updated", { lives: this.state.lives || 0 });
      const now = Date.now();
      socket.emit("tide-state", {
        offset: this.getTideOffset(),
        activeUntil: this.state.tideActiveUntil > now ? this.state.tideActiveUntil : 0,
        cooldownUntil: this.state.tideCooldownUntil > now ? this.state.tideCooldownUntil : 0,
      });
    });
  }

  private movementToLane(movement: MovementDirection | undefined): Lane {
    if (movement === "LEFT") return "LEFT";
    if (movement === "RIGHT") return "RIGHT";
    return "CENTER";
  }

  private resolveLaneForShot(shooterRole: PlayerRole | null): Lane {
    if (shooterRole === "SHOOTER_A" || shooterRole === "SHOOTER_B") {
      const shooter = [...this.state.players.values()].find((p) => p.role === shooterRole);
      if (shooter) return this.movementToLane(shooter.lastMovement as MovementDirection | undefined);
    }
    return "CENTER";
  }

  private addPlayer(
    socket: Socket,
    role: PlayerRole | "AUTO" | null | undefined
  ) {
    const maxPlayers = 4;
    if (this.state.players.size >= maxPlayers) {
      socket.emit("waiting", { message: "waiting on new game" });
      return;
    }
    const requested = (role as PlayerRole | "AUTO" | null) ?? "AUTO";
    const used = new Set(
      [...this.state.players.values()].map((p) => p.role)
    );
    let assigned: PlayerRole | null = null;
    if (requested === "AUTO") {
      const order: PlayerRole[] = ["CAPTAIN", "SHOOTER_A", "SHOOTER_B", "ENEMY"];
      assigned = order.find((r) => !used.has(r)) || null;
    } else if (
      requested === "CAPTAIN" ||
      requested === "SHOOTER_A" ||
      requested === "SHOOTER_B" ||
      requested === "ENEMY"
    ) {
      if (!used.has(requested)) assigned = requested;
    }
    if (!assigned) {
      socket.emit("waiting", { message: "waiting on new game" });
      return;
    }
    const player: PlayerInfo = {
      id: socket.id,
      role: assigned,
      state: "CONNECTED",
      kills: 0,
    };
    this.state.players.set(socket.id, player);
    socket.emit("joined", { id: socket.id, role: assigned });
    this.io.emit("players-updated", this.serializePlayers());
    this.emitControllersState();
  }

  private removePlayer(socketId: string) {
    const player = this.state.players.get(socketId);
    if (player) {
      const role = player.role;
      const ctrlSocketId = this.state.controllersByRole.get(role);
      if (ctrlSocketId) {
        this.state.controllersByRole.delete(role);
        this.state.controllerRoleBySocket.delete(ctrlSocketId);
      }
    }
    this.state.players.delete(socketId);
    this.io.emit("players-updated", this.serializePlayers());
    this.emitControllersState();
  }

  private updateMovement(playerId: string, movement: MovementDirection) {
    const player = this.state.players.get(playerId);
    if (!player) return;
    player.lastMovement = movement;
    if (player.role === "CAPTAIN" && this.state.roundActive) {
      this.io.emit("ship-moved", { direction: movement });
    }
  }

  private handleShoot(senderSocketId: string, _lane: Lane) {
    let role: PlayerRole | null = null;
    const player = this.state.players.get(senderSocketId);
    if (player) role = player.role;
    else role = this.state.controllerRoleBySocket.get(senderSocketId) || null;
    const accepted = !!this.state.roundActive && (role === "SHOOTER_A" || role === "SHOOTER_B");
    const targetPlayer = [...this.state.players.values()].find((p) => p.role === role);
    const lane = this.resolveLaneForShot(role);
    const offset = this.getTideOffset();
    const now = Date.now();
    let hit: ActiveEntity | undefined;
    let bestSpawn = Number.POSITIVE_INFINITY;
    if (accepted) {
      for (const m of this.state.monsters.values()) {
        if (this.mapLaneWithOffset(m.lane, offset) !== lane) continue;
        const s = typeof m.spawnedAt === "number" ? m.spawnedAt : now;
        if (s < bestSpawn) {
          bestSpawn = s;
          hit = m;
        }
      }
    }
    if (targetPlayer) {
      this.io.to(targetPlayer.id).emit("controller-shake", {
        type: "SHOOT",
        fromRole: role,
        lane,
        accepted,
        hitId: hit ? hit.id : null,
      });
    }
    if (!accepted) return;
    if (hit) {
      this.state.monsters.delete(hit.id);
      const shooterPlayer = [...this.state.players.values()].find((p) => p.role === role);
      if (shooterPlayer) shooterPlayer.kills = (shooterPlayer.kills || 0) + 1;
      this.io.emit("monster-destroyed", { id: hit.id, lane: hit.lane });
      this.syncEntities();
    } else {
      this.io.to(senderSocketId).emit("shot-missed", { lane });
    }
  }

  public startRound(levelScript?: LevelEvent[]) {
    if (this.state.roundActive) return false;
    this.state.roundActive = true;
    this.state.roundNumber += 1;
    this.state.monsters.clear();
    this.state.obstacles.clear();
    this.clearTimers();
    this.state.levelScript =
      levelScript && levelScript.length > 0
        ? [...levelScript]
        : this.defaultLevelScript();
    this.state.roundStartTs = Date.now();
    this.state.lives = 3;
    if (!this.state.lossProcessedIds) this.state.lossProcessedIds = new Set();
    this.state.lossProcessedIds.clear();

    const rolesPresent = new Set<PlayerRole>([
      ...[...this.state.players.values()].map((p) => p.role),
      ...[...this.state.controllersByRole.keys()],
    ]);
    for (const evt of this.state.levelScript) {
      const t = setTimeout(() => {
        const target: PlayerRole | "ALL" = (evt.forRole === "SHOOTER_A" || evt.forRole === "SHOOTER_B") ? (evt.forRole as PlayerRole) : "ALL";
        if (evt.type === "MONSTER") {
          if (target === "SHOOTER_A" && !rolesPresent.has("SHOOTER_A")) return;
          if (target === "SHOOTER_B" && !rolesPresent.has("SHOOTER_B")) return;
          this.spawn("MONSTER", evt.lane, target);
        }
        else this.spawn("OBSTACLE", evt.lane, target);
      }, evt.atMs);
      this.state.timers.add(t);
    }

    const lastAt =
      (this.state.levelScript.length > 0
        ? Math.max(...this.state.levelScript.map((e) => e.atMs))
        : 0) + 3000;
    const endTimer = setTimeout(() => this.endRound("WIN"), lastAt);
    this.state.timers.add(endTimer);

    this.io.emit("round-started", { round: this.state.roundNumber });
    this.emitLives();
    return true;
  }

  public forceEndGame() {
    this.endRound();
  }

  private endRound(result?: "WIN" | "FAIL") {
    if (!this.state.roundActive) return;
    this.state.roundActive = false;
    this.clearTimers();
    this.state.monsters.clear();
    this.state.obstacles.clear();
    this.state.tideOffset = 0;
    this.state.tideActiveUntil = 0;
    this.syncEntities();
    this.io.emit("round-ended", { round: this.state.roundNumber });
    if (result === "WIN" || result === "FAIL") this.io.emit("game-result", { result });
  }

  private spawn(type: "MONSTER" | "OBSTACLE", lane: Lane, forRole: PlayerRole | "ALL" = "ALL") {
    if (!this.state.roundActive) return;
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    const entity: ActiveEntity = { id, lane, spawnedAt: Date.now(), type, forRole };
    if (type === "MONSTER") this.state.monsters.set(id, entity);
    else this.state.obstacles.set(id, entity);
    this.syncEntities();

    if (type === "MONSTER") {
      const t = setTimeout(() => {
        if (!this.state.roundActive) return;
        const exists = this.state.monsters.has(id);
        if (!exists) return;
        const key = `MONSTER-${id}`;
        if (this.state.lossProcessedIds && this.state.lossProcessedIds.has(key)) return;
        if (this.state.lossProcessedIds) this.state.lossProcessedIds.add(key);
        this.loseLife();
      }, this.travelMs + 550);
      this.state.timers.add(t);
    } else if (type === "OBSTACLE") {
      const t = setTimeout(() => {
        if (!this.state.roundActive) return;
        const exists = this.state.obstacles.has(id);
        if (!exists) return;
        const key = `OBSTACLE-${id}-HIT`;
        if (this.state.lossProcessedIds && this.state.lossProcessedIds.has(key)) return;
        const offset = this.getTideOffset();
        const mappedLane = this.mapLaneWithOffset(lane, offset);
        const captain = [...this.state.players.values()].find((p) => p.role === "CAPTAIN");
        if (!captain) return;
        const captainLane = this.movementToLane(captain.lastMovement as MovementDirection | undefined);
        if (captainLane === mappedLane) {
          if (this.state.lossProcessedIds) this.state.lossProcessedIds.add(key);
          this.loseLife();
        }
      }, this.travelMs);
      this.state.timers.add(t);
    }
  }

  private syncEntities() {
    const offset = this.getTideOffset();
    const mapEntity = (e: ActiveEntity) => ({
      ...e,
      lane: this.mapLaneWithOffset(e.lane, offset),
    });
    this.io.emit("entities", {
      monsters: [...this.state.monsters.values()].map(mapEntity),
      obstacles: [...this.state.obstacles.values()].map(mapEntity),
    });
  }

  private getTideOffset() {
    const now = Date.now();
    if (this.state.tideActiveUntil > now) return this.state.tideOffset;
    return 0;
  }

  private mapLaneWithOffset(lane: Lane, offset: number): Lane {
    if (!offset) return lane;
    const idx = LANES.indexOf(lane);
    return pickLane(idx + offset);
  }

  private activateTide(senderSocketId: string, direction: "LEFT" | "RIGHT") {
    let role: PlayerRole | null = null;
    const p = this.state.players.get(senderSocketId);
    if (p) role = p.role;
    else role = this.state.controllerRoleBySocket.get(senderSocketId) || null;
    const now = Date.now();
    const canApply = this.state.roundActive && role === "ENEMY" && now >= this.state.tideCooldownUntil;
    const targetPlayer = [...this.state.players.values()].find((p) => p.role === role);
    if (targetPlayer) {
      this.io.to(targetPlayer.id).emit("controller-shake", {
        type: "TIDE",
        fromRole: role,
        direction,
        accepted: canApply,
      });
    }
    if (!canApply) return;
    const offset = direction === "LEFT" ? -1 : 1;
    this.state.tideOffset = offset;
    this.state.tideActiveUntil = now + this.state.tideDurationMs;
    this.state.tideCooldownUntil = now + this.state.tideCooldownMs;
    this.io.emit("tide-state", {
      offset,
      activeUntil: this.state.tideActiveUntil,
      cooldownUntil: this.state.tideCooldownUntil,
    });
    this.syncEntities();
    const t = setTimeout(() => {
      if (this.state.tideActiveUntil <= Date.now()) {
        this.state.tideOffset = 0;
        this.state.tideActiveUntil = 0;
        this.io.emit("tide-state", { offset: 0, activeUntil: 0, cooldownUntil: this.state.tideCooldownUntil });
        this.syncEntities();
      }
    }, this.state.tideDurationMs + 10);
    this.state.timers.add(t);
  }

  private pairController(socket: Socket, role: PlayerRole) {
    if (role !== "SHOOTER_A" && role !== "SHOOTER_B" && role !== "ENEMY") return;
    const hasPlayerForRole = [...this.state.players.values()].some(
      (p) => p.role === role
    );
    if (!hasPlayerForRole) return;
    const prevRole = this.state.controllerRoleBySocket.get(socket.id);
    if (prevRole) {
      this.state.controllerRoleBySocket.delete(socket.id);
      const existing = this.state.controllersByRole.get(prevRole);
      if (existing === socket.id) this.state.controllersByRole.delete(prevRole);
    }
    this.state.controllersByRole.set(role, socket.id);
    this.state.controllerRoleBySocket.set(socket.id, role);
    this.emitControllersState();
  }

  private handleStartRound(senderSocketId: string) {
    let role: PlayerRole | null = null;
    const p = this.state.players.get(senderSocketId);
    if (p) role = p.role;
    else role = this.state.controllerRoleBySocket.get(senderSocketId) || null;
    if (role !== "SHOOTER_A" && role !== "SHOOTER_B") return;
    this.startRound();
  }

  private emitControllersState() {
    const readiness = {
      SHOOTER_A: this.state.controllersByRole.has("SHOOTER_A"),
      SHOOTER_B: this.state.controllersByRole.has("SHOOTER_B"),
      ENEMY: this.state.controllersByRole.has("ENEMY"),
    };
    this.io.emit("controllers-updated", readiness);
  }

  private emitLives() {
    this.io.emit("lives-updated", { lives: this.state.lives || 0 });
  }

  private loseLife() {
    if (!this.state.roundActive) return;
    const current = typeof this.state.lives === "number" ? this.state.lives : 0;
    this.state.lives = Math.max(0, current - 1);
    this.emitLives();
    if ((this.state.lives || 0) <= 0) this.endRound("FAIL");
  }

  public getGameStats(): GameStats {
    const totalPlayers = this.state.players.size;
    const activePlayers = [...this.state.players.values()].filter(
      (p) => p.state !== "ELIMINATED"
    ).length;
    const eliminatedPlayers = totalPlayers - activePlayers;
    const rolesRequired: PlayerRole[] = ["CAPTAIN", "SHOOTER_A", "SHOOTER_B", "ENEMY"];
    const playersReady = rolesRequired.every((r) =>
      [...this.state.players.values()].some((p) => p.role === r)
    );
    const controllersReady = ["SHOOTER_A", "SHOOTER_B", "ENEMY"].every((r) =>
      this.state.controllersByRole.has(r as PlayerRole)
    );
    const allReady = playersReady && controllersReady;
    return {
      totalPlayers,
      activePlayers,
      eliminatedPlayers,
      roundNumber: this.state.roundNumber,
      roundActive: this.state.roundActive,
      currentMonsters: this.state.monsters.size,
      currentObstacles: this.state.obstacles.size,
      playersReady,
      controllersReady,
      allReady,
    };
  }

  private clearTimers() {
    for (const t of this.state.timers) clearTimeout(t);
    this.state.timers.clear();
  }

  private serializePlayers() {
    return [...this.state.players.values()].map((p) => ({
      id: p.id,
      role: p.role,
      state: p.state,
      kills: p.kills || 0,
      lastMovement: p.lastMovement || "STILL",
    }));
  }

  private defaultLevelScript(): LevelEvent[] {
    const events: LevelEvent[] = [];
    const obstacleTimes = [
      500, 1700, 2900, 4100, 5300, 6500, 7700, 8900, 10100,
      11300, 12500, 13700, 14900, 16100, 17300,
    ];
    for (let i = 0; i < obstacleTimes.length; i += 1) {
      const laneO: Lane = pickLane(i);
      const tO: number = obstacleTimes[i] as number;
      const spawnAhead: number = Math.max(0, tO - 500);
      const laneMA: Lane = pickLane(i + 1);
      const laneMB: Lane = pickLane(i + 2);
      const shooterRole: PlayerRole = i % 2 === 0 ? "SHOOTER_A" : "SHOOTER_B";
      events.push({ atMs: spawnAhead, type: "MONSTER", lane: laneMA, forRole: shooterRole });
      if (i % 3 === 2) {
        events.push({ atMs: spawnAhead + 200, type: "MONSTER", lane: laneMB, forRole: "ALL" });
      }
      events.push({ atMs: tO, type: "OBSTACLE", lane: laneO });
    }
    return events.sort((a, b) => a.atMs - b.atMs);
  }
}
