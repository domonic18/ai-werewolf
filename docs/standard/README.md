# 规范目录

写代码前先看这里。规范只允许有一个事实来源，文档之间互相引用，不复制结论。

| 文档 | 管什么 | 谁必须遵守 |
|---|---|---|
| [DESIGN-V2.md](./DESIGN-V2.md) | 视觉规范「夜席」：色板、字体、形状、图标、图像、动效、文案语气 | 所有前端改动；新增页面/组件前必读 |
| [DESIGN-PARITY.md](./DESIGN-PARITY.md) | v1.5 设计对齐记录（已被 v2 取代，保留作历史对照） | 追溯旧版差异时参考 |

约定：

- 视觉相关的取舍先改 `DESIGN-V2.md`，再改代码 —— 文档是判据，截图只是证据
- 新增颜色/字号/圆角必须落到语义 token，不在组件里写裸值
- 图标一律来自 `client/src/components/Icon.tsx`，人物头像一律来自 `Avatar.tsx`
- 改完 UI 跑 `npm run screens` 自查六屏，截图存 `docs/screenshots/`
