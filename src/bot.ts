import { idleInput, type Controller, type Player } from './game';
import type { Disc } from './physics';
import { stadium } from './stadium';

const DEAD_ZONE = 3;
const PLAYER_TOP_SPEED = 2.5;
const CORNER_Y = 38;
const SHOT_TARGETS_Y = [0, -CORNER_Y, CORNER_Y];
const SHOOT_RANGE = 240;
const DRIBBLE_AHEAD = 120;
const DRIBBLE_WIDE = 100;
const DRIBBLE_WALL_GAP = 50;
const DEFEND_MARGIN = 30;
const DEFEND_DISTANCE = 80;

/** Simple bot: gets behind the ball, shoots at an open spot in the goal, dribbles around blockers, blocks shots. */
export const botController: Controller = (game, player) => {
  if (game.phase === 'gameover') return idleInput();
  if (game.phase === 'kickoff' && game.kickoffTeam !== player.team) return idleInput();

  const me = player.disc;
  const ball = game.ball;
  const reach = me.radius + ball.radius;
  const goalX = player.team === 'red' ? stadium.fieldWidth : -stadium.fieldWidth;
  const attackDir = Math.sign(goalX);

  // Pick an open spot in the goal; if everything is covered, dribble wide of the nearest blocker.
  const opponents = game.players.filter((p) => p.team !== player.team);
  const openShot = SHOT_TARGETS_Y.find((y) => !isBlocked(ball, goalX, y, opponents));
  const blocker = nearest(ball, opponents);
  const blockerAbove = blocker !== undefined && blocker.disc.y < ball.y;
  const nearGoal = Math.abs(goalX - ball.x) < SHOOT_RANGE;
  const shooting = openShot !== undefined || nearGoal;
  let aimX = goalX;
  let aimY: number;
  if (openShot !== undefined) aimY = openShot;
  else if (nearGoal) aimY = blockerAbove ? CORNER_Y : -CORNER_Y;
  else {
    aimX = ball.x + attackDir * DRIBBLE_AHEAD;
    const limit = stadium.fieldHeight - DRIBBLE_WALL_GAP;
    aimY = Math.max(-limit, Math.min(limit, ball.y + (blockerAbove ? DRIBBLE_WIDE : -DRIBBLE_WIDE)));
  }

  // Predict where the ball will be by the time we can get there.
  const dist = Math.hypot(ball.x - me.x, ball.y - me.y);
  const ticksAhead = Math.min(dist / PLAYER_TOP_SPEED, 60);
  const travel = (1 - Math.pow(ball.damping, ticksAhead)) / (1 - ball.damping);
  const bx = ball.x + ball.vx * travel;
  const by = ball.y + ball.vy * travel;

  const [ax, ay] = normalize(aimX - bx, aimY - by);
  let tx = bx - ax * reach;
  let ty = by - ay * reach;

  const rx = me.x - bx;
  const ry = me.y - by;
  const ballComingAtUs = ball.vx * -attackDir > 1 && (me.x - ball.x) * -attackDir > 0;
  const opponentDist = Math.min(...opponents.map((p) => Math.hypot(p.disc.x - ball.x, p.disc.y - ball.y)));
  if (opponentDist < dist - DEFEND_MARGIN) {
    // Opponent will reach the ball first: stand between the ball and our goal.
    const [hx, hy] = normalize(-goalX - ball.x, -ball.y);
    const cover = Math.min(DEFEND_DISTANCE, Math.hypot(-goalX - ball.x, ball.y) / 2);
    tx = ball.x + hx * cover;
    ty = ball.y + hy * cover;
  } else if (ballComingAtUs) {
    // Ball heading for our goal and we're in between: step into its path to block it.
    const [vx, vy] = normalize(ball.vx, ball.vy);
    const along = (me.x - ball.x) * vx + (me.y - ball.y) * vy;
    tx = ball.x + vx * along;
    ty = ball.y + vy * along;
  } else if (rx * ax + ry * ay > -reach * 0.5) {
    // On the wrong side of the ball: go around it instead of pushing it backwards.
    const side = rx * -ay + ry * ax >= 0 ? 1 : -1;
    tx = bx - ax * (reach + 10) - ay * side * (reach + 20);
    ty = by - ay * (reach + 10) + ax * side * (reach + 20);
  }

  const dx = tx - me.x;
  const dy = ty - me.y;

  const [kx, ky] = normalize(ball.x - me.x, ball.y - me.y);
  const [gx, gy] = normalize(goalX - ball.x, aimY - ball.y);
  const inRange = dist - reach < 4;
  const aligned = kx * gx + ky * gy > 0.85;

  return {
    left: dx < -DEAD_ZONE,
    right: dx > DEAD_ZONE,
    up: dy < -DEAD_ZONE,
    down: dy > DEAD_ZONE,
    kick: shooting && inRange && aligned,
  };
};

function isBlocked(ball: Disc, targetX: number, targetY: number, opponents: Player[]): boolean {
  const [gx, gy] = normalize(targetX - ball.x, targetY - ball.y);
  return opponents.some(({ disc }) => {
    const ox = disc.x - ball.x;
    const oy = disc.y - ball.y;
    const along = ox * gx + oy * gy;
    const across = Math.abs(ox * -gy + oy * gx);
    return along > 0 && across < disc.radius + ball.radius + 10;
  });
}

function nearest(ball: Disc, players: Player[]): Player | undefined {
  let best: Player | undefined;
  let bestDist = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.disc.x - ball.x, p.disc.y - ball.y);
    if (d < bestDist) [best, bestDist] = [p, d];
  }
  return best;
}

function normalize(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y) || 1;
  return [x / len, y / len];
}
