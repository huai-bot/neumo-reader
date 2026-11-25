export interface SourcePoint { offset: number; height: number }
export interface EditorView {
  entry: SourcePoint;
  saved?: { top: number; start: number; end: number; direction: HTMLTextAreaElement["selectionDirection"] };
}

export const normalizeSource = (text: string) => text.replace(/\r\n?/g, "\n");
const limit = (value: number, max: number) => Math.max(0, Math.min(max, value));
const first: SourcePoint = { offset: 0, height: 0 };
const mapped = "[data-source-pos]";
const bounds = (element: HTMLElement) => element.dataset.sourcePos!.split(":").map(Number);

function caretRect(node: Text, offset: number) {
  const range = document.createRange();
  range.setStart(node, limit(offset, node.length));
  range.collapse(true);
  return range.getBoundingClientRect();
}

function textRuns(element: HTMLElement, source: string) {
  const [start, end] = bounds(element);
  if (element.classList.contains("plain-text") && element.firstChild instanceof Text) return [{ node: element.firstChild, start, end }];
  const raw = source.slice(start, end);
  const runs: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.length || node.parentElement?.closest("button,.md-code-lang,.md-alert-title,.katex-mathml")) continue;
    const text = normalizeSource(node.data);
    const index = raw.indexOf(text, cursor);
    if (index < 0) continue;
    cursor = index + text.length;
    runs.push({ node, start: start + index, end: start + cursor });
  }
  return runs;
}

export function fromReader(scroll: HTMLElement, root: HTMLElement, source: string): SourcePoint {
  const box = scroll.getBoundingClientRect();
  const fromRange = (range?: AbstractRange | null): SourcePoint | null => {
    if (!range || !root.contains(range.startContainer)) return null;
    const node = range.startContainer;
    const element = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(mapped);
    if (!element || !root.contains(element)) return null;
    const rect = node instanceof Text ? caretRect(node, range.startOffset) : element.getBoundingClientRect();
    if (!rect.height || rect.bottom <= box.top || rect.top >= box.bottom) return null;
    const [start, end] = bounds(element);
    const run = textRuns(element, source).find(item => item.node === node);
    const local = node instanceof Text && node.data.includes("\r\n") ? normalizeSource(node.data.slice(0, range.startOffset)).length : range.startOffset;
    const offset = run ? run.start + local : start + (node instanceof Text ? Math.round((end - start) * local / Math.max(1, node.length)) : 0);
    return { offset, height: limit((rect.top - box.top) / box.height, 1) };
  };
  const selection = window.getSelection();
  const native = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const chosen = fromRange(selection?.isCollapsed ? null : native) ?? fromRange(CSS.highlights?.get("find-current")?.values().next().value) ?? fromRange(native);
  if (chosen) return chosen;
  if (scroll.scrollTop <= 1) return first;
  const left = Math.max(box.left, root.getBoundingClientRect().left) + 4;
  for (let inset = 8; inset < box.height; inset += 18) {
    const point = fromRange(document.caretRangeFromPoint(left, box.top + inset));
    if (point) return point;
  }
  const visible = Array.from(root.querySelectorAll<HTMLElement>(mapped)).find(element => {
    const rect = element.getBoundingClientRect();
    return rect.height && rect.bottom > box.top && rect.top < box.bottom;
  });
  return visible ? { offset: bounds(visible)[0], height: 0 } : { offset: Math.round(source.length * scroll.scrollTop / Math.max(1, scroll.scrollHeight - scroll.clientHeight)), height: 0 };
}

export function toReader(scroll: HTMLElement, root: HTMLElement, source: string, point: SourcePoint) {
  if (!point.offset) { scroll.scrollTop = 0; return true; }
  let nearest: HTMLElement | null = null, gap = Infinity, size = Infinity;
  for (const element of root.querySelectorAll<HTMLElement>(mapped)) {
    const [start, end] = bounds(element);
    const distance = Math.max(start - point.offset, point.offset - Math.max(start, end - 1), 0);
    if (distance < gap || (distance === gap && end - start <= size)) {
      nearest = element; gap = distance; size = end - start;
    }
  }
  if (!nearest) return false;
  for (let details = nearest.closest("details"); details; details = details.parentElement?.closest("details") ?? null) details.open = true;
  const runs = textRuns(nearest, source);
  const run = runs.find(item => item.end > point.offset) ?? runs[runs.length - 1];
  let local = run ? limit(point.offset - run.start, run.end - run.start) : 0;
  if (run) {
    const text = run.node.data;
    for (let newline = text.indexOf("\r\n"); newline !== -1 && newline < local; newline = text.indexOf("\r\n", newline + 2)) local++;
  }
  const rect = run ? caretRect(run.node, local) : nearest.getBoundingClientRect();
  if (!rect.height) return false;
  scroll.scrollTop += rect.top - scroll.getBoundingClientRect().top - point.height * scroll.clientHeight;
  return true;
}

function measureLines<Result>(area: HTMLTextAreaElement, text: string, measure: (topAt: (offset: number) => number) => Result) {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed", visibility: "hidden", pointerEvents: "none", top: "0", left: "0", boxSizing: "border-box",
    width: `${area.clientWidth}px`, padding: style.padding, fontFamily: style.fontFamily, fontSize: style.fontSize,
    fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing,
    tabSize: style.tabSize, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: style.wordBreak, direction: style.direction,
  });
  const node = document.createTextNode(text + "\u200b");
  mirror.append(node);
  document.body.append(mirror);
  try { return measure(offset => caretRect(node, offset).top); }
  finally { mirror.remove(); }
}

export function openEditorAt(area: HTMLTextAreaElement, view: EditorView) {
  area.focus({ preventScroll: true });
  if (view.saved) {
    const { start, end, direction, top } = view.saved;
    area.setSelectionRange(start, end, direction);
    area.scrollTop = top;
    return;
  }
  const offset = limit(view.entry.offset, area.value.length);
  area.setSelectionRange(offset, offset);
  if (!offset) { area.scrollTop = 0; return; }
  const lineEnd = area.value.indexOf("\n", offset);
  const text = lineEnd < 0 ? area.value : area.value.slice(0, lineEnd + 1);
  area.scrollTop = measureLines(area, text, topAt => topAt(offset)) - view.entry.height * area.clientHeight;
}

export function fromEditor(area: HTMLTextAreaElement): SourcePoint {
  const caret = area.selectionDirection === "backward" ? area.selectionStart : area.selectionEnd;
  if (!caret && !area.scrollTop) return first;
  return measureLines(area, area.value, topAt => {
    const caretY = topAt(caret) - area.scrollTop;
    if (caretY >= 0 && caretY < area.clientHeight) return { offset: caret, height: caretY / area.clientHeight };
    if (!area.scrollTop) return first;
    let low = 0, high = area.value.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (topAt(middle) < area.scrollTop) low = middle + 1;
      else high = middle;
    }
    return { offset: low, height: limit((topAt(low) - area.scrollTop) / area.clientHeight, 1) };
  });
}

export function afterDiscard(point: SourcePoint, draft: string, original: string): SourcePoint {
  if (draft === original) return point;
  let head = 0, tail = 0;
  const shorter = Math.min(draft.length, original.length);
  while (head < shorter && draft[head] === original[head]) head++;
  while (tail < shorter - head && draft[draft.length - tail - 1] === original[original.length - tail - 1]) tail++;
  const offset = point.offset >= draft.length - tail ? point.offset + original.length - draft.length : Math.min(point.offset, original.length - tail);
  return { ...point, offset: limit(offset, original.length) };
}
