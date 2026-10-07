import { BALL_PHYSICS, type Game, type Team } from './game';
import { netPoints, postPositions, stadium } from './stadium';

export interface RenderDisc {
  x: number;
  y: number;
  radius: number;
}

export interface RenderPlayer extends RenderDisc {
  team: Team;
  name: string;
  avatar: string;
  kicking: boolean;
}

export interface RenderView {
  ball: RenderDisc;
  players: RenderPlayer[];
  goalBanner: { team: Team; ticksLeft: number } | null;
}

export interface HudState {
  red: number;
  blue: number;
  seconds: number;
  overtime: boolean;
}

export const EMPTY_VIEW: RenderView = {
  ball: { x: 0, y: 0, radius: BALL_PHYSICS.radius },
  players: [],
  goalBanner: null,
};

/** `alpha` is how far we are between the last two physics steps (0..1). */
export function viewFromGame(game: Game, alpha: number): RenderView {
  const lerp = (d: { x: number; y: number; px: number; py: number }) => ({
    x: d.px + (d.x - d.px) * alpha,
    y: d.py + (d.y - d.py) * alpha,
  });
  return {
    ball: { ...lerp(game.ball), radius: game.ball.radius },
    players: game.players.map((p) => ({
      ...lerp(p.disc),
      radius: p.disc.radius,
      team: p.team,
      name: p.name,
      avatar: p.avatar,
      kicking: p.input.kick,
    })),
    goalBanner: game.phase === 'goal' && game.lastScorer ? { team: game.lastScorer, ticksLeft: game.goalTimer } : null,
  };
}

const COLORS = {
  grass: '#718c5a',
  grassStripe: '#6b8655',
  line: '#c7e6bd',
  red: '#e56e56',
  blue: '#5689e5',
  redPost: '#ffcccc',
  bluePost: '#ccccff',
  outline: '#000000',
  kicking: '#ffffff',
  ball: '#ffffff',
};
const STRIPE_WIDTH = 60;
const VIEW_MARGIN = 30;

const GOAL_TEXT: Record<Team, string> = { red: 'Gol do Vermelho!', blue: 'Gol do Azul!' };

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  draw(view: RenderView): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const scale = Math.min(w / (stadium.width * 2 + VIEW_MARGIN * 2), h / (stadium.height * 2 + VIEW_MARGIN * 2));

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, w / 2, h / 2);

    this.drawGrass(w / 2 / scale, h / 2 / scale);
    this.drawLines();
    this.drawDisc(view.ball, COLORS.ball, COLORS.outline);
    for (const player of view.players) {
      const color = player.team === 'red' ? COLORS.red : COLORS.blue;
      this.drawDisc(player, color, player.kicking ? COLORS.kicking : COLORS.outline);
      this.drawPlayerLabels(player);
    }
    this.drawPosts();

    if (view.goalBanner) this.drawGoalBanner(view.goalBanner.team, view.goalBanner.ticksLeft);
  }

  private drawGrass(halfW: number, halfH: number): void {
    const { ctx } = this;
    ctx.fillStyle = COLORS.grassStripe;
    const first = Math.floor(-halfW / STRIPE_WIDTH);
    for (let i = first; i * STRIPE_WIDTH < halfW; i++) {
      if (i % 2 === 0) ctx.fillRect(i * STRIPE_WIDTH, -halfH, STRIPE_WIDTH, halfH * 2);
    }
  }

  private drawLines(): void {
    const { ctx } = this;
    const { fieldWidth: fw, fieldHeight: fh, kickoffRadius } = stadium;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';

    ctx.strokeRect(-fw, -fh, fw * 2, fh * 2);

    ctx.beginPath();
    ctx.moveTo(0, -fh);
    ctx.lineTo(0, fh);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, kickoffRadius, 0, Math.PI * 2);
    ctx.stroke();

    for (const side of [-1, 1] as const) {
      const net = netPoints(side);
      ctx.beginPath();
      ctx.moveTo(net[0].x, net[0].y);
      for (const p of net.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  private drawPosts(): void {
    const { ctx } = this;
    for (const post of postPositions()) {
      ctx.beginPath();
      ctx.arc(post.x, post.y, stadium.postRadius, 0, Math.PI * 2);
      ctx.fillStyle = post.side < 0 ? COLORS.redPost : COLORS.bluePost;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.outline;
      ctx.stroke();
    }
  }

  private drawDisc(disc: RenderDisc, fill: string, outline: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = outline;
    ctx.stroke();
  }

  private drawPlayerLabels({ avatar, name, x, y, radius }: RenderPlayer): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (avatar) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px Arial, Helvetica, sans-serif';
      ctx.fillText(avatar, x, y + 1);
    }
    ctx.font = '10px Arial, Helvetica, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillText(name, x, y + radius + 11);
  }

  private drawGoalBanner(team: Team, ticksLeft: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = Math.min(1, ticksLeft / 30);
    ctx.font = 'bold 56px Arial, Helvetica, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(GOAL_TEXT[team], 0, 0);
    ctx.fillStyle = team === 'red' ? COLORS.red : COLORS.blue;
    ctx.fillText(GOAL_TEXT[team], 0, 0);
    ctx.restore();
  }
}
