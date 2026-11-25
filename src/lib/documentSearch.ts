export interface TextBlock {
  text: string;
  spans: { node: Text; start: number }[];
}

const boundary = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|CAPTION|DD|DETAILS|DIV|DL|DT|FIGCAPTION|FIGURE|H[1-6]|HR|LI|OL|P|PRE|SECTION|SUMMARY|TABLE|TD|TH|TR|UL)$/;
const skip = "button,input,select,textarea,script,style,[hidden],.md-code-lang,.md-alert-title,.katex-mathml";

export function indexDocument(root: HTMLElement): TextBlock[] {
  const blocks: TextBlock[] = [];
  let spans: TextBlock["spans"] = [];
  let length = 0;
  const flush = () => {
    if (!length) return;
    const text = spans.map(({ node }) => node.data).join("");
    if (/\S/u.test(text)) blocks.push({ text, spans });
    spans = [];
    length = 0;
  };
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (node.length) {
        spans.push({ node, start: length });
        length += node.length;
      }
      return;
    }
    if (!(node instanceof HTMLElement) || node.matches(skip) || node.style.display === "none" || node.style.visibility === "hidden") return;
    const separate = boundary.test(node.tagName);
    if (separate) flush();
    node.childNodes.forEach(visit);
    if (separate) flush();
  };
  visit(root);
  flush();
  return blocks;
}

function spanAt(block: TextBlock, offset: number) {
  let low = 0;
  let high = block.spans.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if (block.spans[middle].start <= offset) low = middle;
    else high = middle - 1;
  }
  return block.spans[low];
}

export const MATCH_PAGE = 512;

export function blockRange(block: TextBlock, start: number, end: number) {
  const first = spanAt(block, start);
  const last = spanAt(block, end - 1);
  const range = new Range();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

export function searchDocument(blocks: TextBlock[], query: string) {
  const literal = query.trim().split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const pattern = new RegExp(literal, "giu");
  const pages: { blockIndex: number; offset: number }[] = [];
  let count = 0;
  if (literal) blocks.forEach((block, blockIndex) => {
    pattern.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = pattern.exec(block.text))) {
      if (count % MATCH_PAGE === 0) pages.push({ blockIndex, offset: hit.index });
      count++;
    }
  });

  return {
    count,
    ranges(page: number): Range[] {
      const ranges: Range[] = [];
      const cursor = pages[page];
      if (!cursor) return ranges;
      const size = Math.min(MATCH_PAGE, count - page * MATCH_PAGE);
      for (let index = cursor.blockIndex; ranges.length < size && index < blocks.length; index++) {
        const block = blocks[index];
        pattern.lastIndex = index === cursor.blockIndex ? cursor.offset : 0;
        let hit: RegExpExecArray | null;
        while (ranges.length < size && (hit = pattern.exec(block.text))) {
          ranges.push(blockRange(block, hit.index, pattern.lastIndex));
        }
      }
      return ranges;
    },
  };
}
