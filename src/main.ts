import './style.css';
import { botController } from './bot';
import { Game, TICK_RATE, type PlayerConfig, type Team } from './game';
import { BINDINGS, keyboardController } from './input';
import { OnlineUi } from './online/ui';
import { Renderer, viewFromGame, type HudState } from './render';
import { byId, showPanel } from './ui';

type LocalMode = 'solo' | 'versus';
type Mode = LocalMode | 'demo' | 'online';

const STEP_MS = 1000 / TICK_RATE;
const MATCH_OPTIONS = { timeLimitMinutes: 3, scoreLimit: 3 };
const TEAM_NAMES: Record<Team, string> = { red: 'Vermelho', blue: 'Azul' };

const hud = {
  scoreRed: byId('score-red'),
  scoreBlue: byId('score-blue'),
  clock: byId('clock'),
  ping: byId('ping'),
};

const renderer = new Renderer(byId<HTMLCanvasElement>('game'));
const online = new OnlineUi(showMenu);
let mode: Mode = 'demo';
let lastLocalMode: LocalMode = 'solo';
let game = createGame('demo');
let accumulator = 0;
let lastTime = performance.now();

function createGame(m: LocalMode | 'demo'): Game {
  const players: PlayerConfig[] =
    m === 'solo'
      ? [
          { id: 1, name: 'Você', avatar: '1', team: 'red', controller: keyboardController(BINDINGS.solo) },
          { id: 2, name: 'Bot', avatar: 'B', team: 'blue', controller: botController },
        ]
      : m === 'versus'
        ? [
            { id: 1, name: 'Jogador 1', avatar: '1', team: 'red', controller: keyboardController(BINDINGS.wasd) },
            { id: 2, name: 'Jogador 2', avatar: '2', team: 'blue', controller: keyboardController(BINDINGS.arrows) },
          ]
        : [
            { id: 1, name: 'Bot A', avatar: 'A', team: 'red', controller: botController },
            { id: 2, name: 'Bot B', avatar: 'B', team: 'blue', controller: botController },
          ];
  // The demo match behind the menu never ends.
  return new Game(players, m === 'demo' ? { timeLimitMinutes: 0, scoreLimit: 0 } : MATCH_OPTIONS);
}

function startLocalMatch(m: LocalMode): void {
  mode = lastLocalMode = m;
  game = createGame(m);
  accumulator = 0;
  showPanel(null);
}

function showMenu(): void {
  mode = 'demo';
  game = createGame('demo');
  showPanel('menu');
}

function showGameOver(): void {
  byId('result-title').textContent = `${TEAM_NAMES[game.winner!]} venceu!`;
  byId('result-score').textContent = `${game.score.red} - ${game.score.blue}`;
  showPanel('game-over');
}

function updateHud(state: HudState, ping: number | null): void {
  hud.scoreRed.textContent = String(state.red);
  hud.scoreBlue.textContent = String(state.blue);
  const s = state.seconds;
  hud.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  hud.clock.classList.toggle('overtime', state.overtime);
  hud.ping.classList.toggle('hidden', ping === null);
  if (ping !== null) hud.ping.textContent = `${ping} ms`;
}

function frame(now: number): void {
  const session = online.session;
  if (session) session.update(now);

  if (mode === 'online' && session && online.showingRoom) {
    const { view, hud: state } = session.view(now);
    renderer.draw(view);
    updateHud(state, session.ping);
  } else {
    // Local match, or the demo match behind menus and lobby screens.
    accumulator += Math.min(now - lastTime, 250);
    while (accumulator >= STEP_MS) {
      game.tick();
      accumulator -= STEP_MS;
    }
    if (game.phase === 'gameover' && (mode === 'solo' || mode === 'versus') && byId('overlay').classList.contains('hidden')) {
      showGameOver();
    }
    renderer.draw(viewFromGame(game, accumulator / STEP_MS));
    updateHud({ red: game.score.red, blue: game.score.blue, seconds: game.seconds, overtime: game.overtime }, session?.ping ?? null);
  }
  lastTime = now;
  requestAnimationFrame(frame);
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) =>
  button.addEventListener('click', () => startLocalMatch(button.dataset.mode as LocalMode)),
);
byId('play-online').addEventListener('click', () => {
  mode = 'online';
  online.open();
});
byId('play-again').addEventListener('click', () => startLocalMatch(lastLocalMode));
byId('back-to-menu').addEventListener('click', showMenu);

// Space/Enter must not re-trigger a clicked button during play.
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) e.target.blur();
});
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (mode === 'online') online.handleEscape();
  else if (mode !== 'demo') showMenu();
});

requestAnimationFrame(frame);
