import type { SuperbrowserApi } from '../../preload/ui.ts';
import type { LibraryReply, Suggestion } from '../../shared/types.ts';
import { googleSearchUrl } from '../../core/address.ts';

type Row = { el: HTMLElement; url: string; search: boolean };

function span(className: string, text: string): HTMLElement {
  const e = document.createElement('span');
  e.className = className;
  e.textContent = text;
  return e;
}

/** The dropdown under the address field. Reply data is untrusted: rows are built with textContent only. */
export function setupSuggestions(opts: {
  address: HTMLInputElement; list: HTMLElement; sb: SuperbrowserApi; currentUrl: () => string;
}): { onReply(r: LibraryReply): void; close(): void } {
  const { address, list, sb, currentUrl } = opts;
  let typed = '';
  let seq = 0;
  let rows: Row[] = [];
  let selected = -1;
  let lastInputType = '';

  function close(): void {
    rows = [];
    selected = -1;
    list.replaceChildren();
    list.hidden = true;
  }

  function go(row: Row): void {
    sb.send({ type: 'navigate', input: row.search ? googleSearchUrl(typed) : row.url });
    close();
    address.blur();
  }

  function select(i: number): void {
    selected = i;
    rows.forEach((r, n) => r.el.classList.toggle('on', n === i));
    const row = rows[i];
    address.value = row === undefined ? typed : row.search ? typed : row.url;
  }

  function makeRow(item: Suggestion | null): Row {
    const el = document.createElement('div');
    el.className = item ? 'sg' : 'sg web';
    const text = document.createElement('div');
    text.className = 'sg-t';
    if (item) {
      text.append(span('sg-title', item.title || item.url), span('sg-url', item.url));
      el.append(span('icon ph', ''), text);
      if (item.bookmarked) el.append(span('sg-star', '★'));
    } else {
      text.append(span('sg-title', `Search Google for “${typed}”`));
      el.append(span('icon ph', ''), text);
    }
    const row: Row = { el, url: item?.url ?? '', search: item === null };
    // mousedown + preventDefault keeps focus in the field so blur doesn't close the list first.
    el.addEventListener('mousedown', (e) => { e.preventDefault(); go(row); });
    return row;
  }

  address.addEventListener('input', (e) => {
    lastInputType = (e as InputEvent).inputType ?? '';
    typed = address.value;
    if (typed.trim() === '') { seq++; close(); return; }
    sb.send({ type: 'suggest', seq: ++seq, text: typed });
  });

  address.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      const row = rows[selected];
      if (row) go(row);
      else {
        const input = address.value.trim();
        if (input) sb.send({ type: 'navigate', input });
        close();
        address.blur();
      }
    } else if (e.key === 'Escape') {
      close();
      address.value = currentUrl();
      address.blur();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && rows.length > 0) {
      e.preventDefault();
      const last = rows.length - 1;
      const next = e.key === 'ArrowDown' ? (selected >= last ? -1 : selected + 1) : (selected < 0 ? last : selected - 1);
      select(next);
    }
  });

  address.addEventListener('blur', close);

  function onReply(r: LibraryReply): void {
    if (r.kind !== 'suggestions' || r.seq !== seq || r.text !== typed || typed.trim() === '') return;
    if (document.activeElement !== address) return;
    rows = [...r.items.map((i) => makeRow(i)), makeRow(null)];
    selected = -1;
    list.replaceChildren(...rows.map((x) => x.el));
    list.hidden = false;
    const c = r.completion;
    if (c !== null && c.length > typed.length && c.toLowerCase().startsWith(typed.toLowerCase())
      && !lastInputType.startsWith('delete')
      && address.selectionStart === typed.length && address.selectionEnd === typed.length && address.value === typed) {
      address.value = typed + c.slice(typed.length);
      address.setSelectionRange(typed.length, address.value.length);
    }
  }

  return { onReply, close };
}
