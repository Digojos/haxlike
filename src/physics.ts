export type Layer = 'ball' | 'red' | 'blue';
export const ALL_LAYERS: Layer[] = ['ball', 'red', 'blue'];

export interface Disc {
  x: number;
  y: number;
  /** Position before the last step, used to interpolate rendering. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  invMass: number;
  damping: number;
  bCoef: number;
  layer: Layer;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bCoef: number;
  mask: Layer[];
}

/** Keeps discs on the side where `nx * x + ny * y >= dist + radius`. */
export interface Plane {
  nx: number;
  ny: number;
  dist: number;
  bCoef: number;
  mask: Layer[];
}

/** Immovable circle: goal posts, kickoff circle. */
export interface Post {
  x: number;
  y: number;
  radius: number;
  bCoef: number;
  mask: Layer[];
}

export function createDisc(opts: Partial<Disc> & Pick<Disc, 'radius' | 'layer'>): Disc {
  return { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, invMass: 1, damping: 0.99, bCoef: 0.5, ...opts };
}

export class World {
  discs: Disc[] = [];
  segments: Segment[] = [];
  planes: Plane[] = [];
  posts: Post[] = [];

  step(): void {
    for (const d of this.discs) {
      d.px = d.x;
      d.py = d.y;
      d.x += d.vx;
      d.y += d.vy;
      d.vx *= d.damping;
      d.vy *= d.damping;
    }

    const n = this.discs.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) collideDiscs(this.discs[i], this.discs[j]);
    }

    for (const d of this.discs) {
      for (const p of this.posts) if (p.mask.includes(d.layer)) collidePost(d, p);
      for (const s of this.segments) if (s.mask.includes(d.layer)) collideSegment(d, s);
      for (const p of this.planes) if (p.mask.includes(d.layer)) collidePlane(d, p);
    }
  }
}

function collideDiscs(a: Disc, b: Disc): void {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.radius + b.radius;
  const d2 = dx * dx + dy * dy;
  const totalInvMass = a.invMass + b.invMass;
  if (d2 >= r * r || totalInvMass === 0) return;

  const d = Math.sqrt(d2);
  const nx = d > 0 ? dx / d : 1;
  const ny = d > 0 ? dy / d : 0;

  const overlap = r - d;
  a.x += nx * overlap * (a.invMass / totalInvMass);
  a.y += ny * overlap * (a.invMass / totalInvMass);
  b.x -= nx * overlap * (b.invMass / totalInvMass);
  b.y -= ny * overlap * (b.invMass / totalInvMass);

  const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vn < 0) {
    const impulse = (-(1 + a.bCoef * b.bCoef) * vn) / totalInvMass;
    a.vx += nx * impulse * a.invMass;
    a.vy += ny * impulse * a.invMass;
    b.vx -= nx * impulse * b.invMass;
    b.vy -= ny * impulse * b.invMass;
  }
}

/** Pushes a disc out along the normal and reflects the inbound part of its velocity. */
function bounceStatic(d: Disc, nx: number, ny: number, penetration: number, bCoef: number): void {
  d.x += nx * penetration;
  d.y += ny * penetration;
  const vn = d.vx * nx + d.vy * ny;
  if (vn < 0) {
    const k = (1 + bCoef * d.bCoef) * vn;
    d.vx -= nx * k;
    d.vy -= ny * k;
  }
}

function collidePost(d: Disc, p: Post): void {
  const dx = d.x - p.x;
  const dy = d.y - p.y;
  const r = d.radius + p.radius;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r || d2 === 0) return;
  const dist = Math.sqrt(d2);
  bounceStatic(d, dx / dist, dy / dist, r - dist, p.bCoef);
}

function collideSegment(d: Disc, s: Segment): void {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const t = Math.max(0, Math.min(1, ((d.x - s.x1) * sx + (d.y - s.y1) * sy) / (sx * sx + sy * sy)));
  const dx = d.x - (s.x1 + sx * t);
  const dy = d.y - (s.y1 + sy * t);
  const d2 = dx * dx + dy * dy;
  if (d2 >= d.radius * d.radius || d2 === 0) return;
  const dist = Math.sqrt(d2);
  bounceStatic(d, dx / dist, dy / dist, d.radius - dist, s.bCoef);
}

function collidePlane(d: Disc, p: Plane): void {
  const gap = d.x * p.nx + d.y * p.ny - p.dist;
  if (gap < d.radius) bounceStatic(d, p.nx, p.ny, d.radius - gap, p.bCoef);
}
