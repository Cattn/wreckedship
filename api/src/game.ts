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
}

const LANES: Lane[] = ["LEFT", "CENTER", "RIGHT"];
const pickLane = (index: number): Lane => {
  const i = ((index % LANES.length) + LANES.length) % LANES.length;
  return LANES[i] as Lane;
};

export class GameManager {
  private io: Server;
  private state: InternalState;

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
    });
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

  private handleShoot(senderSocketId: string, lane: Lane) {
    if (!this.state.roundActive) return;
    let role: PlayerRole | null = null;
    const player = this.state.players.get(senderSocketId);
    if (player) role = player.role;
    else role = this.state.controllerRoleBySocket.get(senderSocketId) || null;
    if (role !== "SHOOTER_A" && role !== "SHOOTER_B") return;

    const offset = this.getTideOffset();
    const hit = [...this.state.monsters.values()].find(
      (m) => this.mapLaneWithOffset(m.lane, offset) === lane
    );
    if (hit) {
      this.state.monsters.delete(hit.id);
      const shooterPlayer = [...this.state.players.values()].find(
        (p) => p.role === role
      );
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

    for (const evt of this.state.levelScript) {
      const t = setTimeout(() => {
        const offset = this.getTideOffset();
        const mappedLane = this.mapLaneWithOffset(evt.lane, offset);
        if (evt.type === "MONSTER") this.spawn("MONSTER", mappedLane);
        else this.spawn("OBSTACLE", mappedLane);
      }, evt.atMs);
      this.state.timers.add(t);
    }

    const lastAt =
      (this.state.levelScript.length > 0
        ? Math.max(...this.state.levelScript.map((e) => e.atMs))
        : 0) + 3000;
    const endTimer = setTimeout(() => this.endRound(), lastAt);
    this.state.timers.add(endTimer);

    this.io.emit("round-started", { round: this.state.roundNumber });
    return true;
  }

  public forceEndGame() {
    this.endRound();
  }

  private endRound() {
    if (!this.state.roundActive) return;
    this.state.roundActive = false;
    this.clearTimers();
    this.state.monsters.clear();
    this.state.obstacles.clear();
    this.state.tideOffset = 0;
    this.state.tideActiveUntil = 0;
    this.syncEntities();
    this.io.emit("round-ended", { round: this.state.roundNumber });
  }

  private spawn(type: "MONSTER" | "OBSTACLE", lane: Lane) {
    if (!this.state.roundActive) return;
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
    const entity: ActiveEntity = { id, lane, spawnedAt: Date.now(), type };
    if (type === "MONSTER") this.state.monsters.set(id, entity);
    else this.state.obstacles.set(id, entity);
    this.syncEntities();
  }

  private syncEntities() {
    this.io.emit("entities", {
      monsters: [...this.state.monsters.values()],
      obstacles: [...this.state.obstacles.values()],
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
    if (!this.state.roundActive) return;
    let role: PlayerRole | null = null;
    const p = this.state.players.get(senderSocketId);
    if (p) role = p.role;
    else role = this.state.controllerRoleBySocket.get(senderSocketId) || null;
    if (role !== "ENEMY") return;
    const now = Date.now();
    if (now < this.state.tideCooldownUntil) return;
    const offset = direction === "LEFT" ? -1 : 1;
    this.state.tideOffset = offset;
    this.state.tideActiveUntil = now + this.state.tideDurationMs;
    this.state.tideCooldownUntil = now + this.state.tideCooldownMs;
    this.io.emit("tide-state", {
      offset,
      activeUntil: this.state.tideActiveUntil,
    });
    const t = setTimeout(() => {
      if (this.state.tideActiveUntil <= Date.now()) {
        this.state.tideOffset = 0;
        this.state.tideActiveUntil = 0;
        this.io.emit("tide-state", { offset: 0, activeUntil: 0 });
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

  private emitControllersState() {
    const readiness = {
      SHOOTER_A: this.state.controllersByRole.has("SHOOTER_A"),
      SHOOTER_B: this.state.controllersByRole.has("SHOOTER_B"),
      ENEMY: this.state.controllersByRole.has("ENEMY"),
    };
    this.io.emit("controllers-updated", readiness);
  }

  public getGameStats(): GameStats {
    const totalPlayers = this.state.players.size;
    const activePlayers = [...this.state.players.values()].filter(
      (p) => p.state !== "ELIMINATED"
    ).length;
    const eliminatedPlayers = totalPlayers - activePlayers;
    return {
      totalPlayers,
      activePlayers,
      eliminatedPlayers,
      roundNumber: this.state.roundNumber,
      roundActive: this.state.roundActive,
      currentMonsters: this.state.monsters.size,
      currentObstacles: this.state.obstacles.size,
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
    let t = 500;
    for (let i = 0; i < 8; i += 1) {
      const laneA: Lane = pickLane(i);
      const laneB: Lane = pickLane(i + 1);
      events.push({ atMs: t, type: "MONSTER", lane: laneA });
      if (i % 3 === 2)
        events.push({ atMs: t + 400, type: "OBSTACLE", lane: laneB });
      t += 1000;
    }
    return events;
  }
}
