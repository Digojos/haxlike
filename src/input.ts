import type { InputState } from './game';

export interface KeyBinding {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  kick: string[];
}

export const BINDINGS = {
  solo: {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    kick: ['KeyX', 'Space'],
  },
  wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], kick: ['Space'] },
  arrows: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    kick: ['Enter', 'NumpadEnter', 'Numpad0'],
  },
} satisfies Record<string, KeyBinding>;

const gameKeys = new Set(Object.values(BINDINGS).flatMap((b) => Object.values(b).flat()));
const pressed = new Set<string>();

export const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target) || !gameKeys.has(e.code)) return;
  pressed.add(e.code);
  e.preventDefault();
});
window.addEventListener('keyup', (e) => pressed.delete(e.code));
window.addEventListener('blur', () => pressed.clear());
// Release everything when focus moves into a text field (e.g. the chat), so the player stops.
window.addEventListener('focusin', (e) => {
  if (isTypingTarget(e.target)) pressed.clear();
});

export function keyboardController(binding: KeyBinding): () => InputState {
  const any = (codes: string[]) => codes.some((code) => pressed.has(code));
  return () => ({
    up: any(binding.up),
    down: any(binding.down),
    left: any(binding.left),
    right: any(binding.right),
    kick: any(binding.kick),
  });
}
