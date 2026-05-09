/** Minimal ANSI-escape → HTML converter for the LogPanel. */

const ANSI_PATTERN = /\[(\d+(?:;\d+)*)m/g;

const COLOR_VARS: Record<number, string> = {
  // Foreground basic
  30: '#5a6580', // black → slate-muted (closest readable on dark bg)
  31: '#ff5252', // red    → danger-red
  32: '#00ff41', // green  → terminal-green
  33: '#ffb74d', // yellow → warm-amber
  34: '#00e5ff', // blue   → neon-cyan
  35: '#ff5252', // magenta (fall back to red — no perfect token match)
  36: '#00e5ff', // cyan   → neon-cyan
  37: '#e8eaed', // white  → ghost-white
  // Bright variants — same mapping for v1
  90: '#5a6580',
  91: '#ff5252',
  92: '#00ff41',
  93: '#ffb74d',
  94: '#00e5ff',
  95: '#ff5252',
  96: '#00e5ff',
  97: '#e8eaed',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert a string containing ANSI color escapes into HTML where each colored
 * run is wrapped in `<span style="color:...">`. Bold (`1m`) is mapped to
 * `font-weight:700`. Other escape codes are dropped.
 */
export function ansiToHtml(input: string): string {
  let result = '';
  let lastIndex = 0;
  let openSpan = false;

  ANSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_PATTERN.exec(input)) !== null) {
    const literal = input.slice(lastIndex, match.index);
    if (literal) result += escapeHtml(literal);
    lastIndex = match.index + match[0].length;

    const codes = (match[1] ?? '').split(';').map((c) => Number.parseInt(c, 10));
    if (openSpan) {
      result += '</span>';
      openSpan = false;
    }
    if (codes.includes(0) || codes.length === 0) continue;

    const styles: string[] = [];
    for (const code of codes) {
      if (code === 1) styles.push('font-weight:700');
      else if (COLOR_VARS[code]) styles.push(`color:${COLOR_VARS[code]}`);
    }
    if (styles.length > 0) {
      result += `<span style="${styles.join(';')}">`;
      openSpan = true;
    }
  }
  const tail = input.slice(lastIndex);
  if (tail) result += escapeHtml(tail);
  if (openSpan) result += '</span>';
  return result;
}
