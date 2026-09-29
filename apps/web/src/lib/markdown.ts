/**
 * A deliberately small markdown subset for chat answers: code fences, headings,
 * lists and paragraphs, with inline code, bold and [n] citation markers. It
 * produces data rather than HTML, so answers are rendered as React elements and
 * nothing the model writes is ever injected as markup.
 */

export type Block =
  | { type: 'code'; language: string; text: string }
  | { type: 'heading'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; text: string };

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'cite'; markers: number[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (list) blocks.push({ type: 'list', ...list });
    paragraph = [];
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flush();
      const code: string[] = [];
      // An unclosed fence (mid-stream) runs to the end of the text.
      while (++i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i]!);
      blocks.push({ type: 'code', language: fence[1] ?? '', text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', text: heading[1]! });
      continue;
    }
    const item = line.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      const ordered = Boolean(item[2]);
      if (paragraph.length || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[3]!);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (list) {
      // Indented continuation of the previous list item.
      if (/^\s{2,}/.test(line)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`;
        continue;
      }
      flush();
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) });
    if (match[1] !== undefined) parts.push({ type: 'code', text: match[1] });
    else if (match[2] !== undefined) parts.push({ type: 'bold', text: match[2] });
    else parts.push({ type: 'cite', markers: match[3]!.split(',').map((n) => Number(n.trim())) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

/** Parses one Server-Sent Events block ("event: x\ndata: {...}") into its JSON payload. */
export function parseSseBlock(block: string): unknown {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
