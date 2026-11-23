import type { Anchor } from "../lib/state";

/** step：有序列表 / 任务列表的每一项单独成卡；section：每个标题一张卡 */
export type CardSplit = "section" | "step";

export interface Card {
  /** 这张卡片显示的正文顶层块（按文档顺序显示） */
  blocks: HTMLElement[];
  /** 拆成步骤时：所在列表与要显示的列表项 */
  item?: { list: HTMLElement; li: HTMLElement };
  /** 所在章节标题 */
  title: string;
  /** 在所在列表中是第几步 */
  step?: { n: number; total: number };
  /** 卡片开头在完整排版中的位置，用于和主窗口同步阅读位置 */
  anchor: Anchor;
}

const isHeading = (el: Element) => /^H[1-6]$/.test(el.tagName);
const text = (el: HTMLElement | undefined) => (el?.textContent ?? "").trim();

/** 可以拆成步骤的列表：有序列表或任务列表，且至少两项 */
function stepItems(el: HTMLElement): HTMLElement[] | null {
  const task =
    el.tagName === "UL" &&
    (el.classList.contains("contains-task-list") || el.querySelector(":scope > li.task-list-item") !== null);
  if (el.tagName !== "OL" && !task) return null;
  const lis = Array.from(el.children).filter((c): c is HTMLElement => c.tagName === "LI");
  return lis.length >= 2 ? lis : null;
}

/** 必须在所有块都可见（完整排版）时调用 */
export function buildCards(root: HTMLElement, split: CardSplit): Card[] {
  const kids = Array.from(root.children) as HTMLElement[];
  const index = new Map(kids.map((k, i) => [k, i]));
  const anchorOf = (el: HTMLElement, li?: HTMLElement): Anchor => {
    const i = index.get(el) ?? 0;
    if (!li) return { i, f: 0 };
    const r = el.getBoundingClientRect();
    const lr = li.getBoundingClientRect();
    return { i, f: r.height > 0 ? Math.max(0, (lr.top - r.top) / r.height) : 0 };
  };

  // 分节：标题 + 其后的块。只有标题、没有内容的节（如文档大标题紧跟二级标题）并入下一节
  type Section = { heads: HTMLElement[]; blocks: HTMLElement[] };
  const sections: Section[] = [];
  let cur: Section = { heads: [], blocks: [] };
  for (const el of kids) {
    if (isHeading(el)) {
      if (cur.blocks.length) {
        sections.push(cur);
        cur = { heads: [el], blocks: [] };
      } else cur.heads.push(el);
    } else cur.blocks.push(el);
  }
  if (cur.heads.length || cur.blocks.length) sections.push(cur);

  const cards: Card[] = [];
  for (const sec of sections) {
    const title = text(sec.heads[sec.heads.length - 1]) || "开头";
    const first = sec.heads[0] ?? sec.blocks[0];
    const whole: Card = { blocks: [...sec.heads, ...sec.blocks], title, anchor: anchorOf(first) };
    if (split === "section") {
      cards.push(whole);
      continue;
    }
    // 按步骤：列表前的说明归入第一步，列表后的内容归入最后一步
    const out: Card[] = [];
    let lead: HTMLElement[] = [];
    for (const b of sec.blocks) {
      const lis = stepItems(b);
      if (!lis) {
        lead.push(b);
        continue;
      }
      if (b.tagName === "OL") {
        // 其他项隐藏后序号会从 1 重新数，固定每一项的序号
        const start = (b as HTMLOListElement).start || 1;
        lis.forEach((li, k) => ((li as HTMLLIElement).value = start + k));
      }
      const intro = lead;
      lis.forEach((li, k) =>
        out.push({
          blocks: [...sec.heads, ...(k === 0 ? intro : []), b],
          item: { list: b, li },
          title,
          step: { n: k + 1, total: lis.length },
          anchor: k === 0 ? anchorOf(sec.heads[0] ?? intro[0] ?? b) : anchorOf(b, li),
        }),
      );
      lead = [];
    }
    if (!out.length) {
      cards.push(whole);
      continue;
    }
    if (lead.length) out[out.length - 1].blocks.push(...lead);
    cards.push(...out);
  }
  return cards;
}

/** 主窗口的阅读位置落在哪张卡片 */
export function cardForAnchor(cards: Card[], a: Anchor): number {
  let found = 0;
  cards.forEach((c, k) => {
    if (c.anchor.i < a.i || (c.anchor.i === a.i && c.anchor.f <= a.f + 0.02)) found = k;
  });
  return found;
}

export function showCard(root: HTMLElement, cards: Card[], idx: number) {
  const card = cards[idx];
  if (!card) return;
  const show = new Set(card.blocks);
  let first = true;
  for (const el of Array.from(root.children) as HTMLElement[]) {
    const on = show.has(el);
    el.style.display = on ? "" : "none";
    // 卡片里第一个块去掉上边距，标题贴着顶部
    el.style.marginTop = on && first ? "0" : "";
    if (on) first = false;
  }
  for (const c of cards) {
    if (!c.item) continue;
    const hide = card.item && c.item.list === card.item.list && c.item.li !== card.item.li;
    c.item.li.style.display = hide ? "none" : "";
  }
}

/** 恢复完整排版 */
export function resetCards(root: HTMLElement, cards: Card[]) {
  for (const el of Array.from(root.children) as HTMLElement[]) {
    el.style.display = "";
    el.style.marginTop = "";
  }
  for (const c of cards) if (c.item) c.item.li.style.display = "";
}
