/**
 * Raw-mode key parser: turns stdin byte chunks into discrete key events.
 * Handles single presses, escape sequences (arrows, Home/End, PgUp/PgDn,
 * Delete, Ctrl+arrows), Alt+Backspace, and multi-char paste runs.
 */

export type Key =
  | { type: 'text'; text: string }
  | { type: 'enter' }
  | { type: 'tab' }
  | { type: 'esc' }
  | { type: 'ignore' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'pgup' }
  | { type: 'pgdn' }
  | { type: 'wordleft' }
  | { type: 'wordright' }
  | { type: 'ctrl'; key: string };

/** Parse one stdin chunk into key events (pure — unit-testable). */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  let text = '';
  const flush = (): void => {
    if (text.length > 0) {
      keys.push({ type: 'text', text });
      text = '';
    }
  };
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === '\x1b') {
      flush();
      const rest = chunk.slice(i);
      const seq = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest);
      if (seq !== undefined && seq !== null) {
        const [, params = '', final = ''] = seq;
        i += 1 + 1 + params.length + 1; // ESC [ params final
        keys.push(mapSequence(params, final));
        continue;
      }
      const next = chunk[i + 1];
      if (next === undefined) {
        keys.push({ type: 'esc' });
        i += 1;
        continue;
      }
      if (next === '\x7f') {
        // Alt+Backspace → delete word backwards.
        keys.push({ type: 'ctrl', key: 'w' });
      }
      // Other Alt+key combos are ignored.
      i += 2;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      flush();
      keys.push({ type: 'enter' });
      i += 1;
      continue;
    }
    if (ch === '\t') {
      flush();
      keys.push({ type: 'tab' });
      i += 1;
      continue;
    }
    if (ch === '\x7f' || ch === '\x08') {
      flush();
      keys.push({ type: 'backspace' });
      i += 1;
      continue;
    }
    const code = ch?.codePointAt(0) ?? 0;
    if (code < 32) {
      flush();
      // C0 control → Ctrl+letter (0x01='a' … 0x1a='z').
      if (code >= 1 && code <= 26) {
        keys.push({ type: 'ctrl', key: String.fromCharCode(code + 96) });
      }
      // Other C0 controls (incl. 0x1c–0x1f) are ignored.
      i += ch !== undefined && code > 0xffff ? 2 : 1;
      continue;
    }
    text += ch;
    i += ch !== undefined && code > 0xffff ? 2 : 1;
  }
  flush();
  return keys;
}

function mapSequence(params: string, final: string): Key {
  const ctrlArrow = params.startsWith('1;5') || params.startsWith('5;');
  switch (final) {
    case 'A':
      return ctrlArrow ? { type: 'pgup' } : { type: 'up' };
    case 'B':
      return ctrlArrow ? { type: 'pgdn' } : { type: 'down' };
    case 'C':
      return ctrlArrow ? { type: 'wordright' } : { type: 'right' };
    case 'D':
      return ctrlArrow ? { type: 'wordleft' } : { type: 'left' };
    case 'H':
      return { type: 'home' };
    case 'F':
      return { type: 'end' };
    case 'Z':
      return { type: 'tab' }; // Shift+Tab — treat as Tab.
    case '~':
      switch (params) {
        case '1':
        case '7':
          return { type: 'home' };
        case '3':
          return { type: 'delete' };
        case '4':
        case '8':
          return { type: 'end' };
        case '5':
          return { type: 'pgup' };
        case '6':
          return { type: 'pgdn' };
        default:
          return { type: 'ignore' }; // unknown — safely ignored downstream
      }
    default:
      return { type: 'ignore' }; // unknown — safely ignored downstream
  }
}
