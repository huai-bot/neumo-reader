import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { blockRange, indexDocument } from "../lib/documentSearch";
import { locateQuote, quoteSlice, readMarks, selectionSlices, sortedSlices, writeMarks } from "../lib/annotations";
import type { Mark, Slice } from "../lib/annotations";
import { IconClose, IconCopy, IconHighlight, IconNote, IconTrash, IconUnderline } from "./Icons";
import "../styles/annotations.css";

interface Props {
  docKey: string;
  content: string;
  renderHtml: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onWarn: (message: string, tone: "warn") => void;
}
interface Point { x: number; y: number }
interface SelectionState { slices: Slice[]; point: Point | null; id?: string }
const empty: SelectionState = { slices: [], point: null };
const wordBreaker = new Intl.Segmenter("zh", { granularity: "word" });
const same = (left: Slice[], right: Slice[]) => left.length === right.length && left.every((part, index) =>
  part.block === right[index].block && part.start === right[index].start && part.end === right[index].end);

function paint(name: string, ranges: Range[], priority: number) {
  if (!CSS.highlights) return;
  if (!ranges.length) { CSS.highlights.delete(name); return; }
  const ink = new Highlight();
  ink.priority = priority;
  for (const range of ranges) ink.add(range);
  CSS.highlights.set(name, ink);
}

export function AnnotationTools({ docKey, content, renderHtml, contentRef, scrollRef, onWarn }: Props) {
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [pick, setPick] = useState<SelectionState>(empty);
  const selected = useRef(pick);
  const [note, setNote] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const drawn = useRef<{ mark: Mark; slices: Slice[]; ranges: Range[] }[]>([]);
  const index = useMemo(() => {
    let blocks: ReturnType<typeof indexDocument> | undefined;
    return () => blocks ??= contentRef.current ? indexDocument(contentRef.current) : [];
  }, [content, renderHtml, contentRef]);
  const choose = useCallback((value: SelectionState, openNote: string | null = null) => {
    selected.current = value;
    setPick(value);
    setNote(openNote);
  }, []);
  const clear = useCallback(() => {
    const selection = window.getSelection();
    if (selection?.anchorNode && contentRef.current?.contains(selection.anchorNode)) selection.removeAllRanges();
    choose(empty);
  }, [choose, contentRef]);
  useEffect(() => {
    let alive = true;
    readMarks(docKey).then(items => { if (alive) setMarks(items); }).catch(() => {
      if (alive) onWarn("批注无法读取，重新打开文件后再试。", "warn");
    });
    return () => { alive = false; };
  }, [docKey, onWarn]);
  useLayoutEffect(() => { clear(); }, [index, clear]);
  useLayoutEffect(() => {
    drawn.current = (marks ?? []).map(mark => {
      const slices = mark.quotes.map(quote => locateQuote(index(), quote)).filter((part): part is Slice => !!part);
      return { mark, slices, ranges: slices.map(part => blockRange(index()[part.block], part.start, part.end)) };
    });
    for (const [style, priority] of [["highlight", -5], ["line", -4], ["note", -3]] as const) {
      paint(`ink-${style}`, drawn.current.filter(item => item.mark[style]).flatMap(item => item.ranges), priority);
    }
    return () => { for (const style of ["highlight", "line", "note"]) CSS.highlights?.delete(`ink-${style}`); };
  }, [index, marks]);
  useLayoutEffect(() => {
    if (pick === selected.current) paint("ink-selection", pick.slices.map(part => blockRange(index()[part.block], part.start, part.end)), 3);
    return () => { CSS.highlights?.delete("ink-selection"); };
  }, [pick, index]);

  useLayoutEffect(() => {
    const bar = panel.current, scroll = scrollRef.current, point = pick.point;
    if (!bar || !scroll || !point) return;
    const place = () => {
      const box = scroll.getBoundingClientRect();
      const top = point.y - bar.offsetHeight - 17;
      bar.style.left = `${Math.max(box.left + 4, Math.min(point.x - bar.offsetWidth / 2, box.right - bar.offsetWidth - 6))}px`;
      bar.style.top = `${Math.max(box.top + 4, Math.min(top < box.top ? point.y + 16 : top, box.bottom - bar.offsetHeight - 4))}px`;
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(bar); resize.observe(scroll);
    return () => resize.disconnect();
  }, [pick.point, scrollRef, marks]);

  useEffect(() => {
    const root = contentRef.current, scroll = scrollRef.current;
    if (!root || !scroll) return;
    let gesture: { base: Slice[]; anchor: Range | null; from: Point; id: number } | null = null;
    let cancelClick = false;
    const textAt = (point: Point) => {
      const caret = document.caretRangeFromPoint(point.x, point.y);
      return caret && root.contains(caret.startContainer) ? caret : null;
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element) || panel.current?.contains(event.target)) return;
      cancelClick = false;
      if (!root.contains(event.target) || event.target.closest("button,input,textarea,select")) { clear(); return; }
      const from = { x: event.clientX, y: event.clientY };
      const additive = (event.ctrlKey || event.metaKey) && !event.altKey;
      const base = additive ? selected.current.slices : [];
      const anchor = additive ? textAt(from) : null;
      gesture = { base, anchor, from, id: event.pointerId };
      choose({ slices: base, point: null });
      if (anchor) {
        event.preventDefault();
        scroll.focus({ preventScroll: true });
        window.getSelection()?.collapse(anchor.startContainer, anchor.startOffset);
      }
    };
    const extend = (event: PointerEvent) => {
      if (!gesture?.anchor || gesture.id !== event.pointerId) return;
      const box = scroll.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) scroll.scrollTop += event.clientY < box.top ? -22 : 22;
      const caret = textAt({ x: Math.min(box.right - 12, Math.max(box.left, event.clientX)), y: Math.min(box.bottom - 2, Math.max(box.top + 1, event.clientY)) });
      if (caret) window.getSelection()?.setBaseAndExtent(gesture.anchor.startContainer, gesture.anchor.startOffset, caret.startContainer, caret.startOffset);
    };
    const showSelection = (slices: Slice[], point: Point) => {
      const existing = drawn.current.find(item => same(item.slices, slices));
      choose({ slices, point, id: existing?.mark.id });
    };
    const up = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const { base, anchor, from } = gesture;
      const point = { x: event.clientX, y: event.clientY };
      const selection = window.getSelection();
      const moved = Math.hypot(point.x - from.x, point.y - from.y) > 3;
      if (anchor && moved) extend(event);
      gesture = null;
      if (anchor && !moved && anchor.startContainer instanceof Text) {
        const node = anchor.startContainer;
        const word = wordBreaker.segment(node.data).containing(Math.min(anchor.startOffset, node.length - 1));
        if (word?.isWordLike) selection?.setBaseAndExtent(node, word.index, node, word.index + word.segment.length);
      }
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && !range.collapsed && root.contains(range.commonAncestorContainer)) {
        const slices = sortedSlices([...base, ...selectionSlices(index(), range)]);
        if (slices.length) { cancelClick = true; showSelection(slices, point); return; }
      }
      if (anchor) { cancelClick = true; if (base.length) showSelection(base, point); return; }
      if (moved || (event.target instanceof Element && event.target.closest("a[href]"))) return;
      const caret = textAt(point);
      const hit = caret && [...drawn.current].reverse().find(item => item.ranges.some(ink =>
        ink.isPointInRange(caret.startContainer, caret.startOffset) && Array.from(ink.getClientRects()).some(rect => point.x >= rect.left - 1 && point.x <= rect.right + 1 && point.y >= rect.top && point.y <= rect.bottom + 2)));
      if (hit) { cancelClick = true; choose({ slices: hit.slices, point, id: hit.mark.id }, hit.mark.note || null); }
    };
    const click = (event: MouseEvent) => { if (cancelClick) { cancelClick = false; event.preventDefault(); event.stopPropagation(); } };
    const cancel = () => { gesture = null; };
    const copy = (event: ClipboardEvent) => {
      const slices = selected.current.slices;
      if (!slices.length || (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true],[aria-modal=true]"))) return;
      if (event.clipboardData) {
        event.clipboardData.setData("text/plain", slices.map(part => index()[part.block].text.slice(part.start, part.end)).join("\n"));
        event.preventDefault();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || document.querySelector('[aria-modal="true"]') || (event.target instanceof Element && event.target.closest("input,textarea"))) return;
      if (event.key === "Control" || event.key === "Meta") panel.current?.classList.add("is-picking");
      if (event.key === "Escape" && selected.current.slices.length) { event.preventDefault(); clear(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && (scroll.contains(document.activeElement) || selected.current.slices.length)) {
        const range = document.createRange(); range.selectNodeContents(root);
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); event.preventDefault();
      }
    };
    const keyboardSelection = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") panel.current?.classList.remove("is-picking");
      if (!((event.shiftKey && /^(Arrow|Home|End|Page)/.test(event.key)) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a"))) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const box = range.getBoundingClientRect();
      showSelection(selectionSlices(index(), range), { x: box.left + Math.min(box.width / 2, 80), y: box.top });
    };
    const hideBar = () => { if (selected.current.point && !panel.current?.contains(document.activeElement)) choose({ ...selected.current, point: null }); };
    const onBlur = () => { cancel(); panel.current?.classList.remove("is-picking"); };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", extend);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    root.addEventListener("click", click, true);
    document.addEventListener("copy", copy);
    document.addEventListener("keydown", key);
    document.addEventListener("keyup", keyboardSelection);
    window.addEventListener("blur", onBlur);
    scroll.addEventListener("scroll", hideBar);
    return () => {
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("pointermove", extend);
      document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      root.removeEventListener("click", click, true); document.removeEventListener("copy", copy);
      document.removeEventListener("keydown", key); document.removeEventListener("keyup", keyboardSelection);
      window.removeEventListener("blur", onBlur);
      scroll.removeEventListener("scroll", hideBar);
    };
  }, [index, choose, clear, contentRef, scrollRef]);

  if (!pick.point || !pick.slices.length || marks === null) return null;
  const existing = marks.find(mark => mark.id === pick.id);
  const commit = async (change: Partial<Pick<Mark, "line" | "highlight" | "note">> | null) => {
    if (busy.current) return;
    const item = { ...(existing ?? { id: crypto.randomUUID(), quotes: pick.slices.map(part => quoteSlice(index(), part)), line: false, highlight: false, note: "" }), ...change };
    const next = marks.filter(mark => mark.id !== item.id);
    if (change && (item.line || item.highlight || item.note)) next.push(item);
    busy.current = true; setSaving(true);
    try {
      await writeMarks(docKey, next);
      setMarks(next);
      if (pick === selected.current) clear();
    } catch { onWarn("批注未保存，请检查数据目录是否可写后重试。", "warn"); }
    finally { busy.current = false; setSaving(false); }
  };
  return (
    <div className="annotation-tools" ref={panel} onMouseDown={event => { if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}>
      <div className="ink-buttons" role="toolbar" aria-label="选中文字">
        <button type="button" title="复制 (Ctrl+C)" aria-label="复制选区" onClick={() => void navigator.clipboard.writeText(pick.slices.map(part => index()[part.block].text.slice(part.start, part.end)).join("\n")).catch(() => onWarn("未能复制，请按 Ctrl+C。", "warn"))}><IconCopy size={17} /></button>
        <button type="button" disabled={saving} title="划线" aria-label="划线" aria-pressed={!!existing?.line} onClick={() => void commit({ line: !existing?.line })}><IconUnderline size={17} /></button>
        <button type="button" disabled={saving} title="高亮" aria-label="高亮" aria-pressed={!!existing?.highlight} onClick={() => void commit({ highlight: !existing?.highlight })}><IconHighlight size={18} /></button>
        <button type="button" disabled={saving} title="注释" aria-label="注释" aria-expanded={note !== null} onClick={() => setNote(note === null ? existing?.note ?? "" : null)}><IconNote size={17} /></button>
        {existing && <button type="button" disabled={saving} className="ink-delete" title="删除这条批注" aria-label="删除这条批注" onClick={() => void commit(null)}><IconTrash size={16} /></button>}
      </div>
      {note !== null && <form className="ink-note" onSubmit={event => { event.preventDefault(); void commit({ note: note.trim() }); }}>
        <textarea autoFocus aria-label="注释内容" placeholder="写注释…" value={note} readOnly={saving} onChange={event => setNote(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); clear(); }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
        <div><button type="button" className="ink-cancel" title="取消" aria-label="取消注释" onClick={clear}><IconClose size={15} /></button>
          <button type="submit" disabled={saving || (!existing?.note && !note.trim())}>保存</button></div>
      </form>}
    </div>
  );
}
