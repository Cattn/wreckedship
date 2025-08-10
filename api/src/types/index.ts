export type MovementDirection = "LEFT" | "RIGHT" | "STILL";
export type Lane = "LEFT" | "CENTER" | "RIGHT";
export type PlayerRole = "CAPTAIN" | "ENEMY" | "SHOOTER_A" | "SHOOTER_B";

export interface PlayerInfo {
  id: string;
  role: PlayerRole;
  state: "CONNECTED" | "PLAYING" | "ELIMINATED";
  lastMovement?: MovementDirection;
  kills?: number;
}

export interface LevelEvent {
  atMs: number;
  type: "MONSTER" | "OBSTACLE";
  lane: Lane;
  forRole?: "ALL" | "SHOOTER_A" | "SHOOTER_B";
}

export interface GameStats {
  totalPlayers: number;
  activePlayers: number;
  eliminatedPlayers: number;
  roundNumber: number;
  roundActive: boolean;
  currentMonsters: number;
  currentObstacles: number;
  playersReady: boolean;
  controllersReady: boolean;
  allReady: boolean;
}
