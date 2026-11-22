# 来源说明

花笺阅读（Floral Reader）是一个独立项目，最初参考并改写自
[花笺 Floral Notepaper](https://github.com/Achilng/floral-notepaper)（MIT License，© Achilng）。

- 本项目不是 fork，不跟随上游更新，拥有独立的 git 历史。
- 沿用了上游的技术栈（Tauri 2 + React）以及 Markdown 渲染思路，
  `src/markdown/remarkAlerts.ts` 与 `src/markdown/MarkdownView.tsx` 中的部分代码改写自上游。
- 已移除：便签存储、分类、编辑器、托盘、全局快捷键、磁贴/小窗、图片粘贴、自动更新、多语言等功能。
