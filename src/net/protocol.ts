import type { InputState, Phase, Team } from '../game';

export const MAX_NAME_LENGTH = 25;
export const MAX_ROOM_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 140;
export const MAX_AVATAR_LENGTH = 2;
export const PING_INTERVAL_MS = 2000;
export const MAX_REPORTED_PING = 9999;

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  running: boolean;
}

export interface RoomPlayer {
  id: number;
  name: string;
  avatar: string;
  /** null = spectator. */
  team: Team | null;
  admin: boolean;
  /** Round-trip time in ms, as last reported by the player's client. */
  ping: number;
}

export interface RoomSettings {
  /** 0 = no limit. */
  timeLimitMinutes: number;
  /** 0 = no limit. */
  scoreLimit: number;
}

/** [id, x, y, vx, vy, kicking] */
export type PlayerState = [number, number, number, number, number, 0 | 1];

export interface Snapshot {
  /** Server tick, increases by one per physics step. */
  tick: number;
  phase: Phase;
  kickoffTeam: Team;
  score: Record<Team, number>;
  /** Match clock in ticks. */
  clock: number;
  overtime: boolean;
  lastScorer: Team | null;
  goalTimer: number;
  /** [x, y, vx, vy] */
  ball: [number, number, number, number];
  players: PlayerState[];
}

export type ClientMessage =
  | { t: 'hello'; name: string }
  | { t: 'listRooms' }
  | { t: 'createRoom'; name: string }
  | { t: 'joinRoom'; roomId: string }
  | { t: 'leaveRoom' }
  | { t: 'setTeam'; playerId: number; team: Team | null }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'chat'; text: string }
  | { t: 'input'; seq: number; keys: number }
  /** `ping` = the client's last measured round-trip time, shared with the room. */
  | { t: 'ping'; time: number; ping: number };

export type ServerMessage =
  | { t: 'welcome'; id: number }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'joined'; roomId: string; name: string }
  | { t: 'left' }
  | { t: 'room'; players: RoomPlayer[]; running: boolean; settings: RoomSettings }
  | { t: 'chat'; from: string | null; text: string }
  /** `ack` = last input sequence number the server has applied for the receiving player. */
  | { t: 'state'; ack: number; s: Snapshot }
  | { t: 'error'; message: string }
  | { t: 'pong'; time: number }
  /** Periodic ping update for everyone in the room: [playerId, ms][]. */
  | { t: 'pings'; pings: [number, number][] };

const KEY_BITS = { up: 1, down: 2, left: 4, right: 8, kick: 16 } as const;

export function encodeKeys(input: InputState): number {
  let keys = 0;
  for (const [key, bit] of Object.entries(KEY_BITS)) if (input[key as keyof InputState]) keys |= bit;
  return keys;
}

export function decodeKeys(keys: number): InputState {
  return {
    up: (keys & KEY_BITS.up) !== 0,
    down: (keys & KEY_BITS.down) !== 0,
    left: (keys & KEY_BITS.left) !== 0,
    right: (keys & KEY_BITS.right) !== 0,
    kick: (keys & KEY_BITS.kick) !== 0,
  };
}
