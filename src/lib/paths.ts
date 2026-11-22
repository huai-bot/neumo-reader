const WIN_DRIVE = /^[a-zA-Z]:[\\/]/;

export function isWindowsPath(p: string): boolean {
  return WIN_DRIVE.test(p) || p.startsWith("\\\\");
}

/** 用于比较 / 作为 key 的规范化路径（Windows 下大小写不敏感）。 */
export function pathKey(p: string): string {
  const n = p.replace(/\\/g, "/");
  return isWindowsPath(p) ? n.toLowerCase() : n;
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

export function extOf(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
}

/** 将相对路径解析到 baseDir 下；绝对路径原样规范化。 */
export function resolvePath(baseDir: string, target: string): string {
  const win = isWindowsPath(baseDir) || isWindowsPath(target);
  const t = target.replace(/\\/g, "/");
  const isAbs = /^[a-zA-Z]:\//.test(t) || t.startsWith("/");
  const combined = isAbs ? t : `${baseDir.replace(/\\/g, "/")}/${t}`;
  const unc = combined.startsWith("//");
  const parts = combined.split("/");
  const out: string[] = [];
  parts.forEach((part, i) => {
    if (part === ".") return;
    if (part === "" && i > 0 && !(unc && i === 1)) return;
    if (part === "..") {
      const last = out[out.length - 1];
      if (out.length > 1 || (last !== undefined && last !== "" && !/^[a-zA-Z]:$/.test(last))) out.pop();
      return;
    }
    out.push(part);
  });
  const res = out.join("/");
  return win ? res.replace(/\//g, "\\") : res;
}
