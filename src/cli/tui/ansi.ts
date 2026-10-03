/** Minimal ANSI helpers for the full-screen terminal UI. No dependencies. */

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const YELLOW = '\x1b[33m';
export const BLUE = '\x1b[34m';
export const CYAN = '\x1b[36m';
export const GRAY = '\x1b[90m';

/** Enter/exit the alternate screen buffer (leaves scrollback untouched). */
export const ALT_ENTER = '\x1b[?1049h';
export const ALT_EXIT = '\x1b[?1049l';

export const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';

/** Erase from cursor to end of line. */
export const CLEAR_LINE = '\x1b[K';

/** 1-based cursor positioning. */
export function moveTo(row: number, col: number): string {
  return `\x1b[${Math.max(1, row)};${Math.max(1, col)}H`;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Braille spinner frame for a millisecond timestamp. */
export function spinnerAt(nowMs: number): string {
  const frame = SPINNER_FRAMES[Math.floor(nowMs / 120) % SPINNER_FRAMES.length];
  return frame ?? '⠋';
}
