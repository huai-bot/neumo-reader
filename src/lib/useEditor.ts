import { useCallback, useRef, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { saveDocument } from "./api";
import type { OpenDoc } from "./types";

interface Draft { base: string; revision: string; text: string; saving?: boolean; error?: string }
type Drafts = Record<string, Draft>;
const normalized = (text: string) => text.replace(/\r\n?/g, "\n");
export const isDirty = (draft: Draft) => draft.text !== draft.base;

export function useEditor(onSaved: (key: string, file: Awaited<ReturnType<typeof saveDocument>>) => void) {
  const current = useRef<Drafts>({});
  const [drafts, setDrafts] = useState(current.current);
  const update = useCallback((key: string, next?: Draft) => {
    const all = { ...current.current };
    if (next) all[key] = next; else delete all[key];
    setDrafts(current.current = all);
  }, []);
  const begin = (doc: OpenDoc) => {
    const text = normalized(doc.content);
    update(doc.key, { base: text, revision: doc.revision, text });
  };
  const change = (key: string, text: string) => {
    const draft = current.current[key];
    if (draft && !draft.saving) update(key, { ...draft, text, error: undefined });
  };
  const save = async (doc: OpenDoc) => {
    const draft = current.current[doc.key];
    if (!draft || draft.saving || !isDirty(draft)) return;
    update(doc.key, { ...draft, saving: true, error: undefined });
    try {
      const saved = await saveDocument(doc.path, draft.revision, draft.text);
      onSaved(doc.key, saved);
      const text = normalized(saved.content);
      update(doc.key, { base: text, text, revision: saved.revision });
    } catch (error) {
      update(doc.key, { ...draft, error: typeof error === "string" ? error : "保存失败，草稿已保留。" });
    }
  };
  const asking = useRef(false);
  const leave = useCallback(async (key?: string) => {
    const items = Object.entries(current.current).filter(([id]) => !key || key === id);
    if (asking.current || items.some(([, draft]) => draft.saving)) return false;
    if (items.some(([, draft]) => isDirty(draft))) {
      asking.current = true;
      try {
        if (!await confirm(key ? "放弃这个文件尚未保存的修改？" : "退出并放弃尚未保存的修改？", {
          title: "未保存的修改", kind: "warning", okLabel: "放弃修改", cancelLabel: "继续编辑",
        })) return false;
      } catch { return false; } finally { asking.current = false; }
    }
    for (const [id] of items) update(id);
    return true;
  }, [update]);
  return { drafts, current, begin, change, save, leave };
}
