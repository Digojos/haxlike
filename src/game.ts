import { createDisc, World, type Disc, type Plane, type Post, type Segment } from './physics';
import { buildStadium, stadium } from './stadium';

export type Team = 'red' | 'blue';
export type Phase = 'kickoff' | 'playing' | 'goal' | 'gameover';

export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  kick: boolean;
}

export type Controller = (game: Game, player: Player) => InputState;

export interface PlayerConfig {
  id: number;
  name: string;
  avatar: string;
  team: Team;
  controller: Controller;
}

export interface Player extends PlayerConfig {
  disc: Disc;
  input: InputState;
  /** Kick must be released before it can fire again. */
  kickReady: boolean;
}

export interface GameOptions {
  /** 0 = no limit. */
  timeLimitMinutes: number;
  /** 0 = no limit. */
  scoreLimit: number;
}

export const TICK_RATE = 60;
const GOAL_PAUSE_TICKS = 3 * TICK_RATE;
const SPAWN_OFFSETS = [0, -55, 55, -110, 110];
const KICK_RANGE = 4;

// Default HaxBall tuning.
export const PLAYER_PHYSICS = {
  radius: 15,
  invMass: 0.5,
  damping: 0.96,
  bCoef: 0.5,
  acceleration: 0.1,
  kickingAcceleration: 0.07,
  kickingDamping: 0.96,
  kickStrength: 5,
};
export const BALL_PHYSICS = { radius: 10, invMass: 1, damping: 0.99, bCoef: 0.5 };

export const idleInput = (): InputState => ({ up: false, down: false, left: false, right: false, kick: false });
export const otherTeam = (team: Team): Team => (team === 'red' ? 'blue' : 'red');

export function createPlayerDisc(team: Team): Disc {
  const { radius, invMass, damping, bCoef } = PLAYER_PHYSICS;
  return createDisc({ radius, invMass, damping, bCoef, layer: team });
}

/** Applies one tick of player movement input. Shared with client-side prediction. */
export function applyMovement(disc: Disc, input: InputState): void {
  const dx = Number(input.right) - Number(input.left);
  const dy = Number(input.down) - Number(input.up);
  const len = Math.hypot(dx, dy);
  if (len > 0) {
    const accel = input.kick ? PLAYER_PHYSICS.kickingAcceleration : PLAYER_PHYSICS.acceleration;
    disc.vx += (dx / len) * accel;
    disc.vy += (dy / len) * accel;
  }
  disc.damping = input.kick ? PLAYER_PHYSICS.kickingDamping : PLAYER_PHYSICS.damping;
}

const BASE_COLLIDERS = buildStadium();

/**
 * Static colliders, plus kickoff barriers when `kickoffTeam` is set: each team stays in
 * its half and the defending team also stays out of the center circle.
 */
export function stadiumColliders(kickoffTeam: Team | null): { segments: Segment[]; planes: Plane[]; posts: Post[] } {
  if (kickoffTeam === null) return BASE_COLLIDERS;
  return {
    segments: BASE_COLLIDERS.segments,
    planes: [
      ...BASE_COLLIDERS.planes,
      { nx: -1, ny: 0, dist: 0, bCoef: 0, mask: ['red'] },
      { nx: 1, ny: 0, dist: 0, bCoef: 0, mask: ['blue'] },
    ],
    posts: [
      ...BASE_COLLIDERS.posts,
      { x: 0, y: 0, radius: stadium.kickoffRadius, bCoef: 0, mask: [otherTeam(kickoffTeam)] },
    ],
  };
}

export class Game {
  readonly world = new World();
  readonly ball: Disc;
  readonly players: Player[] = [];
  readonly score: Record<Team, number> = { red: 0, blue: 0 };
  phase: Phase = 'kickoff';
  kickoffTeam: Team = 'red';
  lastScorer: Team | null = null;
  winner: Team | null = null;
  overtime = false;
  /** Match clock, only runs while the ball is in play. */
  ticks = 0;
  goalTimer = 0;

  constructor(configs: PlayerConfig[], readonly options: GameOptions) {
    this.world.segments = BASE_COLLIDERS.segments;
    this.ball = createDisc({ ...BALL_PHYSICS, layer: 'ball' });
    this.world.discs.push(this.ball);
    for (const config of configs) this.addPlayer(config);
    this.startKickoff('red');
  }

  get seconds(): number {
    return Math.floor(this.ticks / TICK_RATE);
  }

  addPlayer(config: PlayerConfig): Player {
    const player: Player = { ...config, disc: createPlayerDisc(config.team), input: idleInput(), kickReady: true };
    const index = this.players.filter((p) => p.team === config.team).length;
    placeDisc(player.disc, spawnX(config.team), SPAWN_OFFSETS[index] ?? 0);
    this.players.push(player);
    this.world.discs.push(player.disc);
    return player;
  }

  removePlayer(id: number): void {
    const index = this.players.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [player] = this.players.splice(index, 1);
    this.world.discs = this.world.discs.filter((d) => d !== player.disc);
  }

  tick(): void {
    if (this.phase === 'gameover') return;

    for (const player of this.players) {
      player.input = player.controller(this, player);
      this.applyInput(player);
    }
    this.world.step();

    switch (this.phase) {
      case 'kickoff':
        if (this.ball.vx !== 0 || this.ball.vy !== 0) this.setColliders(null, 'playing');
        break;
      case 'playing':
        this.ticks++;
        this.checkGoal();
        if (this.phase === 'playing') this.checkTime();
        break;
      case 'goal':
        if (--this.goalTimer <= 0) this.afterGoal();
        break;
    }
  }

  private applyInput(player: Player): void {
    const { input, disc } = player;
    applyMovement(disc, input);

    if (!input.kick) {
      player.kickReady = true;
      return;
    }
    if (!player.kickReady) return;

    const ball = this.ball;
    const bx = ball.x - disc.x;
    const by = ball.y - disc.y;
    const dist = Math.hypot(bx, by);
    if (dist > 0 && dist - disc.radius - ball.radius < KICK_RANGE) {
      ball.vx += (bx / dist) * PLAYER_PHYSICS.kickStrength * ball.invMass;
      ball.vy += (by / dist) * PLAYER_PHYSICS.kickStrength * ball.invMass;
      player.kickReady = false;
    }
  }

  private startKickoff(team: Team): void {
    this.kickoffTeam = team;
    placeDisc(this.ball, 0, 0);
    for (const t of ['red', 'blue'] as const) {
      this.players
        .filter((p) => p.team === t)
        .forEach((p, i) => placeDisc(p.disc, spawnX(t), SPAWN_OFFSETS[i] ?? 0));
    }
    this.setColliders(team, 'kickoff');
  }

  private setColliders(kickoffTeam: Team | null, phase: Phase): void {
    const { planes, posts } = stadiumColliders(kickoffTeam);
    this.world.planes = planes;
    this.world.posts = posts;
    this.phase = phase;
  }

  private checkGoal(): void {
    const { fieldWidth, goalHalf } = stadium;
    const ball = this.ball;
    if (Math.abs(ball.y) >= goalHalf) return;
    if (ball.px > -fieldWidth && ball.x <= -fieldWidth) this.scoreGoal('blue');
    else if (ball.px < fieldWidth && ball.x >= fieldWidth) this.scoreGoal('red');
  }

  private scoreGoal(team: Team): void {
    this.score[team]++;
    this.lastScorer = team;
    this.phase = 'goal';
    this.goalTimer = GOAL_PAUSE_TICKS;
  }

  private afterGoal(): void {
    const scorer = this.lastScorer!;
    const limit = this.options.scoreLimit;
    if (this.overtime || (limit > 0 && this.score[scorer] >= limit)) this.endGame(scorer);
    else this.startKickoff(otherTeam(scorer));
  }

  private checkTime(): void {
    const limit = this.options.timeLimitMinutes * 60 * TICK_RATE;
    if (limit === 0 || this.overtime || this.ticks < limit) return;
    if (this.score.red === this.score.blue) this.overtime = true;
    else this.endGame(this.score.red > this.score.blue ? 'red' : 'blue');
  }

  private endGame(winner: Team): void {
    this.phase = 'gameover';
    this.winner = winner;
  }
}

const spawnX = (team: Team) => (team === 'red' ? -stadium.spawnDistance : stadium.spawnDistance);

function placeDisc(disc: Disc, x: number, y: number): void {
  disc.x = disc.px = x;
  disc.y = disc.py = y;
  disc.vx = disc.vy = 0;
}
