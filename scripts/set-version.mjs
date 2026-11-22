// 一次性修改所有文件中的版本号：npm run version:set -- 0.1.1
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error("用法：npm run version:set -- 0.1.1");
  process.exit(1);
}

function edit(file, transform) {
  if (!existsSync(file)) {
    console.warn(`跳过（不存在）：${file}`);
    return;
  }
  const before = readFileSync(file, "utf8");
  const after = transform(before);
  writeFileSync(file, after);
  console.log(`${after === before ? "未变化" : "已更新"}：${file}`);
}

const firstVersion = (s) => s.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);

edit("package.json", firstVersion);
edit("src-tauri/tauri.conf.json", firstVersion);
edit("src-tauri/Cargo.toml", (s) => s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`));
edit("src-tauri/Cargo.lock", (s) =>
  s.replace(/(name = "neumo-reader"\r?\nversion = ")[^"]+(")/, `$1${version}$2`),
);
edit("package-lock.json", (s) => {
  const lock = JSON.parse(s);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return `${JSON.stringify(lock, null, 2)}\n`;
});

console.log(`\n版本号已设为 ${version}。接下来：
  git commit -am "release: v${version}"
  git tag v${version}
  git push && git push origin v${version}`);
