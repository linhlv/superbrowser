import type { SuperbrowserApi } from '../preload/ui.ts';

declare global {
  interface Window { superbrowser: SuperbrowserApi }
}

const sb = window.superbrowser;
const text = document.getElementById('text') as HTMLInputElement;
const count = document.getElementById('count')!;
const prev = document.getElementById('prev') as HTMLButtonElement;
const next = document.getElementById('next') as HTMLButtonElement;

const find = (forward: boolean) => sb.send({ type: 'find', text: text.value, forward });

function showCount(active: number, matches: number): void {
  count.textContent = text.value ? `${active}/${matches}` : '';
  count.classList.toggle('none', matches === 0);
  prev.disabled = next.disabled = matches === 0;
}

text.addEventListener('input', (e) => {
  if ((e as InputEvent).isComposing) return; // searched once composition ends
  if (!text.value) showCount(0, 0);
  find(true);
});
text.addEventListener('compositionend', () => find(true));
text.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (text.value) find(!e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    sb.send({ type: 'findClose' });
  }
});
prev.addEventListener('click', () => find(false));
next.addEventListener('click', () => find(true));
document.getElementById('close')!.addEventListener('click', () => sb.send({ type: 'findClose' }));

sb.onFindFocus(() => { text.focus(); text.select(); });
sb.onFindResult((r) => showCount(r.active, r.matches));
showCount(0, 0);
