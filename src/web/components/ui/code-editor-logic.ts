/** Pretty-print JSON; `null` when the text is not valid JSON. */
export function formatJsonText(value: string): string | null {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return null;
  }
}

export type JsonToken = { text: string; cls: string };

/** Fault-tolerant JSON highlighter: broken input while typing still renders. */
export function tokenizeJson(chunk: string): JsonToken[] {
  const out: JsonToken[] = [];
  const pattern = /(\s+)|("(?:[^"\\]|\\.)*"?)|(-?\d[\d._]*)|\b(true|false|null)\b|([{}[\],:])|(.)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(chunk)) !== null) {
    const [full, ws, str, num, lit, punct] = match;
    if (ws) {
      out.push({ text: full, cls: 'codeed-ws' });
      continue;
    }
    if (str) {
      const rest = chunk.slice(match.index + full.length);
      out.push({ text: full, cls: /^\s*:/.test(rest) ? 'codeed-key' : 'codeed-str' });
      continue;
    }
    if (num) {
      out.push({ text: num, cls: 'codeed-num' });
      continue;
    }
    if (lit) {
      out.push({ text: lit, cls: 'codeed-lit' });
      continue;
    }
    if (punct) {
      out.push({ text: punct, cls: 'codeed-punct' });
      continue;
    }
    out.push({ text: full, cls: 'codeed-plain' });
  }
  return out;
}
