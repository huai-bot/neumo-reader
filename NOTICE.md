# 致谢与来源说明

拟物阅读（Neumo Reader）是一个独立项目，最初参考并改写自
[花笺 Floral Notepaper](https://github.com/Achilng/floral-notepaper)（MIT License，© 2026 Achilng）。
感谢原作者的开源工作。

- 本项目不是 fork，不跟随上游更新，拥有独立的 git 历史与名称。
- 沿用了上游的技术栈（Tauri 2 + React）以及 Markdown 渲染思路，
  `src/markdown/remarkAlerts.ts` 与 `src/markdown/MarkdownView.tsx` 中的部分代码改写自上游，
  按 MIT 许可要求在 [LICENSE](./LICENSE) 中保留了原作者的版权声明。
- 已移除：便签存储、分类、编辑器、托盘、全局快捷键、磁贴/小窗、图片粘贴、自动更新、多语言等功能。
