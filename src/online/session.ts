import {
  applyMovement,
  BALL_PHYSICS,
  createPlayerDisc,
  idleInput,
  PLAYER_PHYSICS,
  stadiumColliders,
  TICK_RATE,
  type InputState,
} from '../game';
import {
  encodeKeys,
  PING_INTERVAL_MS,
  type ClientMessage,
  type RoomPlayer,
  type RoomSettings,
  type RoomSummary,
  type ServerMessage,
  type Snapshot,
} from '../net/protocol';
import { World, type Disc } from '../physics';
import { EMPTY_VIEW, type HudState, type RenderPlayer, type RenderView } from '../render';

const STEP_MS = 1000 / TICK_RATE;
/** Remote objects are drawn this many ticks in the past so there are always two snapshots to blend. */
const INTERP_DELAY_TICKS = 4;
const SNAPSHOT_BUFFER = 120;
const MAX_PENDING_INPUTS = 120;
/** Per-tick decay of the visual correction applied after a misprediction. */
const SMOOTHING = 0.85;
/** Corrections larger than this (e.g. kickoff reset) snap instead of gliding. */
const SNAP_DISTANCE = 60;
/** How fast the server-clock estimate drifts upward when samples are consistently later. */
const CLOCK_DRIFT = 0.002;

export interface SessionEvents {
  onClose(): void;
  onRooms(rooms: RoomSummary[]): void;
  onJoined(): void;
  onLeft(): void;
  onRoom(): void;
  onChat(from: string | null, text: string): void;
  onError(message: string): void;
}

export class OnlineSession {
  myId = -1;
  roomName = '';
  players: RoomPlayer[] = [];
  running = false;
  settings: RoomSettings = { timeLimitMinutes: 3, scoreLimit: 3 };
  ping = 0;

  private readonly socket: WebSocket;
  private readonly pingTimer: number;
  private snapshots: Snapshot[] = [];
  /** Estimated `performance.now()` at which server tick 0 would have arrived. */
  private clockOffset: number | null = null;

  // Client-side prediction of our own player.
  private seq = 0;
  private pending: { seq: number; input: InputState }[] = [];
  private localInput = idleInput();
  private predicted: Disc | null = null;
  private readonly predictionWorld = new World();
  private smoothX = 0;
  private smoothY = 0;
  private accumulator = 0;
  private lastTime = performance.now();

  constructor(
    name: string,
    private readonly readInput: () => InputState,
    private readonly events: SessionEvents,
  ) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket.addEventListener('open', () => this.send({ t: 'hello', name }));
    this.socket.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.events.onClose();
    });
    this.socket.addEventListener('message', (e) => this.handle(JSON.parse(e.data as string) as ServerMessage));
    this.pingTimer = window.setInterval(
      () => this.send({ t: 'ping', time: performance.now(), ping: this.ping }),
      PING_INTERVAL_MS,
    );
    this.predictionWorld.segments = stadiumColliders(null).segments;
  }

  get me(): RoomPlayer | undefined {
    return this.players.find((p) => p.id === this.myId);
  }

  get inRoom(): boolean {
    return this.roomName !== '';
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  /** Runs fixed client ticks: samples input, sends it and advances the prediction. */
  update(now: number): void {
    this.accumulator = Math.min(this.accumulator + (now - this.lastTime), 250);
    this.lastTime = now;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      this.clientTick();
    }
  }

  view(now: number): { view: RenderView; hud: HudState } {
    const snaps = this.snapshots;
    if (!this.running || snaps.length === 0 || this.clockOffset === null) {
      return { view: EMPTY_VIEW, hud: { red: 0, blue: 0, seconds: 0, overtime: false } };
    }

    // Find the two snapshots around the render time and blend between them.
    const renderTick = (now - this.clockOffset) / STEP_MS - INTERP_DELAY_TICKS;
    let b = snaps.length - 1;
    while (b > 0 && snaps[b - 1].tick >= renderTick) b--;
    const sa = snaps[Math.max(0, b - 1)];
    const sb = snaps[b];
    const span = sb.tick - sa.tick;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTick - sa.tick) / span)) : 1;
    const lerp = (from: number, to: number) => from + (to - from) * alpha;

    const players: RenderPlayer[] = [];
    for (const [id, x, y, , , kicking] of sb.players) {
      const info = this.players.find((p) => p.id === id);
      if (!info?.team) continue;
      const base = { radius: PLAYER_PHYSICS.radius, team: info.team, name: info.name, avatar: info.avatar };
      if (id === this.myId && this.predicted) {
        players.push({
          ...base,
          x: this.predicted.x + this.smoothX,
          y: this.predicted.y + this.smoothY,
          kicking: this.localInput.kick,
        });
        continue;
      }
      const prev = sa.players.find((p) => p[0] === id) ?? [id, x, y];
      players.push({ ...base, x: lerp(prev[1], x), y: lerp(prev[2], y), kicking: kicking === 1 });
    }

    const shown = alpha < 0.5 ? sa : sb;
    return {
      view: {
        ball: { x: lerp(sa.ball[0], sb.ball[0]), y: lerp(sa.ball[1], sb.ball[1]), radius: BALL_PHYSICS.radius },
        players,
        goalBanner: shown.phase === 'goal' && shown.lastScorer ? { team: shown.lastScorer, ticksLeft: shown.goalTimer } : null,
      },
      hud: {
        red: shown.score.red,
        blue: shown.score.blue,
        seconds: Math.floor(shown.clock / TICK_RATE),
        overtime: shown.overtime,
      },
    };
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.myId = message.id;
        break;
      case 'rooms':
        this.events.onRooms(message.rooms);
        break;
      case 'joined':
        this.roomName = message.name;
        this.resetMatchState();
        this.events.onJoined();
        break;
      case 'left':
        this.roomName = '';
        this.players = [];
        this.running = false;
        this.resetMatchState();
        this.events.onLeft();
        break;
      case 'room': {
        const previousTeam = this.me?.team;
        const wasRunning = this.running;
        this.players = message.players;
        this.running = message.running;
        this.settings = message.settings;
        if (wasRunning !== this.running) this.resetMatchState();
        else if (previousTeam !== this.me?.team) this.resetPrediction();
        this.events.onRoom();
        break;
      }
      case 'chat':
        this.events.onChat(message.from, message.text);
        break;
      case 'state':
        this.onSnapshot(message.s, message.ack);
        break;
      case 'error':
        this.events.onError(message.message);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - message.time);
        break;
      case 'pings': {
        const pings = new Map(message.pings);
        this.players = this.players.map((p) => ({ ...p, ping: pings.get(p.id) ?? p.ping }));
        this.events.onRoom();
        break;
      }
    }
  }

  private onSnapshot(snapshot: Snapshot, ack: number): void {
    // Track the earliest-arriving sample: that's the one with the least network jitter.
    const sample = performance.now() - snapshot.tick * STEP_MS;
    if (this.clockOffset === null || sample < this.clockOffset) this.clockOffset = sample;
    else this.clockOffset += (sample - this.clockOffset) * CLOCK_DRIFT;

    this.snapshots.push(snapshot);
    if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();
    this.reconcile(snapshot, ack);
  }

  /** Restart our prediction from the server's state and replay inputs it hasn't processed yet. */
  private reconcile(snapshot: Snapshot, ack: number): void {
    const state = snapshot.players.find((p) => p[0] === this.myId);
    const team = this.me?.team;
    if (!state || !team) return this.resetPrediction();

    const previous = this.predicted ? { x: this.predicted.x, y: this.predicted.y } : null;
    const disc = (this.predicted ??= createPlayerDisc(team));
    [, disc.x, disc.y, disc.vx, disc.vy] = state;

    const { planes, posts } = stadiumColliders(snapshot.phase === 'kickoff' ? snapshot.kickoffTeam : null);
    this.predictionWorld.planes = planes;
    this.predictionWorld.posts = posts;
    this.predictionWorld.discs = [disc];

    this.pending = this.pending.filter((p) => p.seq > ack);
    for (const { input } of this.pending) this.predictStep(input);

    if (previous) {
      this.smoothX += previous.x - disc.x;
      this.smoothY += previous.y - disc.y;
      if (Math.hypot(this.smoothX, this.smoothY) > SNAP_DISTANCE) this.smoothX = this.smoothY = 0;
    }
  }

  private clientTick(): void {
    const playing = this.running && Boolean(this.me?.team);
    this.localInput = playing ? this.readInput() : idleInput();
    this.smoothX *= SMOOTHING;
    this.smoothY *= SMOOTHING;
    if (!playing) return;

    const seq = ++this.seq;
    this.send({ t: 'input', seq, keys: encodeKeys(this.localInput) });
    if (this.predicted) {
      this.pending.push({ seq, input: this.localInput });
      if (this.pending.length > MAX_PENDING_INPUTS) this.pending.shift();
      this.predictStep(this.localInput);
    }
  }

  private predictStep(input: InputState): void {
    applyMovement(this.predicted!, input);
    this.predictionWorld.step();
  }

  private resetPrediction(): void {
    this.predicted = null;
    this.pending = [];
    this.smoothX = this.smoothY = 0;
  }

  private resetMatchState(): void {
    this.snapshots = [];
    this.clockOffset = null;
    this.resetPrediction();
  }
}
