import { Game, idleInput, TICK_RATE, type InputState, type Team } from '../src/game';
import {
  decodeKeys,
  MAX_AVATAR_LENGTH,
  type RoomPlayer,
  type RoomSettings,
  type RoomSummary,
  type ServerMessage,
  type Snapshot,
} from '../src/net/protocol';

export const MAX_PLAYERS_PER_ROOM = 12;
/** Inputs beyond this are dropped so a client that runs ahead can't build up latency. */
const MAX_QUEUED_INPUTS = 4;
const GAME_OVER_DELAY_TICKS = 3 * TICK_RATE;
const TEAM_NAMES: Record<Team, string> = { red: 'Vermelho', blue: 'Azul' };

export interface Client {
  readonly id: number;
  name: string;
  avatar: string;
  ping: number;
  room: Room | null;
  inputQueue: { seq: number; keys: number }[];
  input: InputState;
  /** Last input sequence number applied to the simulation. */
  ackSeq: number;
  send(message: ServerMessage): void;
  sendRaw(json: string): void;
}

export class Room {
  readonly clients = new Map<number, Client>();
  private readonly teams = new Map<number, Team | null>();
  private adminId: number | null = null;
  private settings: RoomSettings = { timeLimitMinutes: 3, scoreLimit: 3 };
  private game: Game | null = null;
  private serverTick = 0;
  private gameOverTicks = 0;

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  get summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      players: this.clients.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      running: this.game !== null,
    };
  }

  get isFull(): boolean {
    return this.clients.size >= MAX_PLAYERS_PER_ROOM;
  }

  join(client: Client): void {
    client.room = this;
    client.inputQueue = [];
    client.input = idleInput();
    this.clients.set(client.id, client);
    this.teams.set(client.id, null);
    this.adminId ??= client.id;
    client.send({ t: 'joined', roomId: this.id, name: this.name });
    this.broadcastRoom();
    this.systemChat(`${client.name} entrou na sala`);
  }

  leave(client: Client): void {
    if (!this.clients.delete(client.id)) return;
    client.room = null;
    this.teams.delete(client.id);
    this.game?.removePlayer(client.id);
    if (this.adminId === client.id) {
      this.adminId = this.clients.keys().next().value ?? null;
      const admin = this.adminId === null ? undefined : this.clients.get(this.adminId);
      if (admin) this.systemChat(`${admin.name} agora é o admin`);
    }
    client.send({ t: 'left' });
    this.broadcastRoom();
    this.systemChat(`${client.name} saiu da sala`);
  }

  setTeam(by: Client, playerId: number, team: Team | null): void {
    const target = this.clients.get(playerId);
    if (!target) return;
    if (by.id !== playerId && by.id !== this.adminId) return by.send({ t: 'error', message: 'Só o admin pode mover outros jogadores' });
    if (this.teams.get(playerId) === team) return;

    this.teams.set(playerId, team);
    if (this.game) {
      this.game.removePlayer(playerId);
      if (team) this.addToGame(target, team);
    }
    this.broadcastRoom();
  }

  updateSettings(by: Client, settings: RoomSettings): void {
    if (!this.requireAdmin(by)) return;
    this.settings = {
      timeLimitMinutes: clampInt(settings.timeLimitMinutes, 0, 60),
      scoreLimit: clampInt(settings.scoreLimit, 0, 99),
    };
    this.broadcastRoom();
  }

  start(by: Client): void {
    if (!this.requireAdmin(by) || this.game) return;
    this.game = new Game([], this.settings);
    this.gameOverTicks = 0;
    for (const client of this.clients.values()) {
      const team = this.teams.get(client.id);
      if (team) this.addToGame(client, team);
    }
    this.broadcastRoom();
    this.systemChat('Partida iniciada');
  }

  stop(by: Client | null): void {
    if ((by && !this.requireAdmin(by)) || !this.game) return;
    this.game = null;
    this.broadcastRoom();
    if (by) this.systemChat(`Partida encerrada por ${by.name}`);
  }

  chat(from: Client, text: string): void {
    const avatar = /^\/avatar(?:\s+(.*))?$/.exec(text);
    if (avatar) {
      from.avatar = [...(avatar[1] ?? '').trim()].slice(0, MAX_AVATAR_LENGTH).join('');
      this.broadcastRoom();
      from.send({ t: 'chat', from: null, text: from.avatar ? `Avatar alterado para ${from.avatar}` : 'Avatar removido' });
      return;
    }
    this.broadcast({ t: 'chat', from: from.name, text });
  }

  tick(): void {
    const game = this.game;
    if (!game) return;

    for (const client of this.clients.values()) {
      if (client.inputQueue.length > MAX_QUEUED_INPUTS) client.inputQueue.splice(0, client.inputQueue.length - MAX_QUEUED_INPUTS);
      const next = client.inputQueue.shift();
      // No new input this tick: keep holding whatever was pressed last.
      if (next) {
        client.input = decodeKeys(next.keys);
        client.ackSeq = next.seq;
      }
    }

    game.tick();
    this.serverTick++;

    const snapshot = JSON.stringify(this.snapshot(game));
    for (const client of this.clients.values()) client.sendRaw(`{"t":"state","ack":${client.ackSeq},"s":${snapshot}}`);

    if (game.phase === 'gameover') {
      if (this.gameOverTicks++ === 0) {
        const winner = game.winner!;
        this.systemChat(`${TEAM_NAMES[winner]} venceu! ${game.score.red} - ${game.score.blue}`);
      }
      if (this.gameOverTicks >= GAME_OVER_DELAY_TICKS) this.stop(null);
    }
  }

  broadcastPings(): void {
    this.broadcast({ t: 'pings', pings: [...this.clients.values()].map((c) => [c.id, c.ping]) });
  }

  private addToGame(client: Client, team: Team): void {
    this.game!.addPlayer({ id: client.id, name: client.name, avatar: client.avatar, team, controller: () => client.input });
  }

  private snapshot(game: Game): Snapshot {
    const b = game.ball;
    return {
      tick: this.serverTick,
      phase: game.phase,
      kickoffTeam: game.kickoffTeam,
      score: game.score,
      clock: game.ticks,
      overtime: game.overtime,
      lastScorer: game.lastScorer,
      goalTimer: game.goalTimer,
      ball: [round(b.x), round(b.y), round(b.vx), round(b.vy)],
      players: game.players.map((p) => [
        p.id,
        round(p.disc.x),
        round(p.disc.y),
        round(p.disc.vx),
        round(p.disc.vy),
        p.input.kick ? 1 : 0,
      ]),
    };
  }

  private requireAdmin(client: Client): boolean {
    if (client.id === this.adminId) return true;
    client.send({ t: 'error', message: 'Só o admin pode fazer isso' });
    return false;
  }

  private broadcastRoom(): void {
    const players: RoomPlayer[] = [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      team: this.teams.get(c.id) ?? null,
      admin: c.id === this.adminId,
      ping: c.ping,
    }));
    this.broadcast({ t: 'room', players, running: this.game !== null, settings: this.settings });
  }

  private systemChat(text: string): void {
    this.broadcast({ t: 'chat', from: null, text });
  }

  private broadcast(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const client of this.clients.values()) client.sendRaw(json);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}
