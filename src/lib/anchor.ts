import type { Anchor } from "./state";

/** 记录视口顶部所在的正文顶层块及块内比例（与 Reader 中的逻辑一致） */
export function captureAnchor(s: HTMLElement | null, c: HTMLElement | null): Anchor | null {
  if (!s || !c) return null;
  if (s.scrollTop <= 1) return { i: 0, f: -1 };
  const top = s.getBoundingClientRect().top;
  const kids = c.children;
  let lo = 0;
  let hi = kids.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > top + 1) {
      found = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  if (found < 0) return null;
  const r = kids[found].getBoundingClientRect();
  return { i: found, f: r.height > 0 ? (top - r.top) / r.height : 0 };
}

export function applyAnchor(s: HTMLElement | null, c: HTMLElement | null, a: Anchor | null): boolean {
  if (!s || !c || !a) return false;
  if (a.f <= -1 && a.i === 0) {
    s.scrollTop = 0;
    return true;
  }
  const el = c.children[a.i] as HTMLElement | undefined;
  if (!el) return false;
  const sr = s.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  s.scrollTop = s.scrollTop + (r.top - sr.top) + a.f * r.height;
  return true;
}
