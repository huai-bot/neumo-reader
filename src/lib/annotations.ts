import { loadAnnotations, saveAnnotations } from "./api";
import type { TextBlock } from "./documentSearch";

export interface Slice { block: number; start: number; end: number }
interface Quote { block: number; start: number; text: string; before: string; after: string }
export interface Mark { id: string; quotes: Quote[]; line: boolean; highlight: boolean; note: string }

const writes = new Map<string, Promise<void>>();
export async function readMarks(key: string): Promise<Mark[]> {
  await writes.get(key)?.catch(() => undefined);
  const raw = await loadAnnotations(key);
  if (raw === null) return [];
  const marks = JSON.parse(raw) as Mark[];
  if (!Array.isArray(marks) || !marks.every(mark => mark && typeof mark.id === "string" && typeof mark.note === "string" &&
    typeof mark.line === "boolean" && typeof mark.highlight === "boolean" && Array.isArray(mark.quotes) && mark.quotes.length &&
    mark.quotes.every(quote => quote && Number.isInteger(quote.block) && Number.isInteger(quote.start) && quote.start >= 0 && quote.block >= 0 &&
      typeof quote.text === "string" && quote.text.length && typeof quote.before === "string" && typeof quote.after === "string"))) throw new Error("批注文件格式不正确");
  return marks;
}
export async function writeMarks(key: string, marks: Mark[]) {
  const write = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => saveAnnotations(key, JSON.stringify(marks)));
  writes.set(key, write);
  try { await write; } finally { if (writes.get(key) === write) writes.delete(key); }
}

export function sortedSlices(slices: Slice[]) {
  const result: Slice[] = [];
  for (const slice of [...slices].sort((left, right) => left.block - right.block || left.start - right.start)) {
    const last = result[result.length - 1];
    if (last && last.block === slice.block && last.end >= slice.start) last.end = Math.max(last.end, slice.end);
    else result.push({ ...slice });
  }
  return result;
}

export function selectionSlices(blocks: TextBlock[], range: Range): Slice[] {
  const slices: Slice[] = [];
  for (const [block, { spans }] of blocks.entries()) {
    const last = spans[spans.length - 1].node;
    if (range.comparePoint(last, last.length) < 0) continue;
    if (range.comparePoint(spans[0].node, 0) > 0) break;
    let start = -1, end = 0;
    for (const span of spans) {
      if (range.comparePoint(span.node, span.node.length) < 0) continue;
      if (range.comparePoint(span.node, 0) > 0) break;
      const left = span.start + (span.node === range.startContainer ? range.startOffset : 0);
      const right = span.start + (span.node === range.endContainer ? range.endOffset : span.node.length);
      if (left < right) { if (start < 0) start = left; end = right; }
    }
    if (start >= 0) slices.push({ block, start, end });
  }
  return slices;
}

export function quoteSlice(blocks: TextBlock[], { block, start, end }: Slice): Quote {
  const text = blocks[block].text;
  return { block, start, text: text.slice(start, end), before: text.slice(Math.max(0, start - 24), start), after: text.slice(end, end + 24) };
}

export function locateQuote(blocks: TextBlock[], quote: Quote): Slice | null {
  const { block, start, text, before, after } = quote;
  const original = blocks[block]?.text;
  if (original?.startsWith(text, start) && original.slice(Math.max(0, start - 24), start) === before && original.slice(start + text.length, start + text.length + 24) === after) {
    return { block, start, end: start + text.length };
  }
  let best: Slice | null = null, score = -1;
  for (const [index, candidate] of blocks.entries()) {
    for (let offset = candidate.text.indexOf(text); offset >= 0; offset = candidate.text.indexOf(text, offset + text.length)) {
      const end = offset + text.length;
      let left = 0, right = 0;
      while (left < before.length && candidate.text[offset - left - 1] === before[before.length - left - 1]) left++;
      while (right < after.length && candidate.text[end + right] === after[right]) right++;
      const rank = left + right;
      if (rank > score) { score = rank; best = { block: index, start: offset, end }; }
      else if (rank === score) best = null;
    }
  }
  return best;
}
