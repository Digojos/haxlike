import { ALL_LAYERS, type Layer, type Plane, type Post, type Segment } from './physics';

/** Dimensions of HaxBall's "Classic" stadium. */
export const stadium = {
  width: 420,
  height: 200,
  fieldWidth: 370,
  fieldHeight: 170,
  goalHalf: 64,
  goalDepth: 30,
  postRadius: 8,
  kickoffRadius: 75,
  spawnDistance: 170,
};

/** Curved goal net behind the goal line on the given side (-1 = left/red, 1 = right/blue). */
export function netPoints(side: -1 | 1, steps = 12): { x: number; y: number }[] {
  const { fieldWidth, goalHalf, goalDepth } = stadium;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + (Math.PI * i) / steps;
    points.push({ x: side * (fieldWidth + goalDepth * Math.cos(angle)), y: goalHalf * Math.sin(angle) });
  }
  return points;
}

export function postPositions(): { x: number; y: number; side: -1 | 1 }[] {
  const { fieldWidth, goalHalf } = stadium;
  return ([-1, 1] as const).flatMap((side) => [-goalHalf, goalHalf].map((y) => ({ x: side * fieldWidth, y, side })));
}

export function buildStadium(): { segments: Segment[]; planes: Plane[]; posts: Post[] } {
  const { width, height, fieldWidth: fw, fieldHeight: fh, goalHalf: gh } = stadium;
  const ballOnly: Layer[] = ['ball'];
  const segments: Segment[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, bCoef: number, mask: Layer[]) =>
    segments.push({ x1, y1, x2, y2, bCoef, mask });

  // Field lines only hold the ball in; players may run outside them.
  line(-fw, -fh, fw, -fh, 1, ballOnly);
  line(-fw, fh, fw, fh, 1, ballOnly);
  for (const side of [-1, 1] as const) {
    const x = side * fw;
    line(x, -fh, x, -gh, 1, ballOnly);
    line(x, gh, x, fh, 1, ballOnly);
    const net = netPoints(side);
    for (let i = 0; i < net.length - 1; i++) line(net[i].x, net[i].y, net[i + 1].x, net[i + 1].y, 0.1, ALL_LAYERS);
  }

  const planes: Plane[] = [
    { nx: 1, ny: 0, dist: -width, bCoef: 0.5, mask: ALL_LAYERS },
    { nx: -1, ny: 0, dist: -width, bCoef: 0.5, mask: ALL_LAYERS },
    { nx: 0, ny: 1, dist: -height, bCoef: 0.5, mask: ALL_LAYERS },
    { nx: 0, ny: -1, dist: -height, bCoef: 0.5, mask: ALL_LAYERS },
  ];

  const posts: Post[] = postPositions().map(({ x, y }) => ({
    x,
    y,
    radius: stadium.postRadius,
    bCoef: 0.5,
    mask: ALL_LAYERS,
  }));

  return { segments, planes, posts };
}
