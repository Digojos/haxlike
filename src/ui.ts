export const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Shows one dialog over the field (hiding the others), or none. */
export function showPanel(id: string | null): void {
  const overlay = byId('overlay');
  overlay.classList.toggle('hidden', id === null);
  for (const dialog of overlay.querySelectorAll<HTMLElement>('.dialog')) dialog.classList.toggle('hidden', dialog.id !== id);
}
