# 技术选型决策记录（ADR）：v1.4 起迁移到 React + TypeScript

- 状态：**已采纳并执行**（2026-10-22：P0 工具链 + P1 前端等价重建已完成，分支 `refactor/react-ts`）
- 日期：2026-10-22
- 决策人：domonic
- 影响版本：v1.4（大厅/观战）起

## 1. 结论（TL;DR）

| 层 | 现状 | 决策 | 是否换框架 |
|---|---|---|---|
| 前端 | 原生 HTML + 468 行命令式 JS（字符串拼接渲染） | **换 React 18 + TypeScript + Vite + Tailwind** | 换 |
| 后端 | Node 原生 http + CJS JS（1280 行） | **换 TypeScript（ESM），保留零框架 http** | 不换框架 |
| 类型 | 前后端各写各的，靠约定 | **抽出 `src/shared/types.ts` 单一事实来源** | 新增 |
| 测试 | 自研 `tests/run-all.js` | **vitest**（前后端统一） | 换 runner |
| 数据库 | WorkBuddy 云服务 PostgREST（`ww_matches`） | 不变 | — |

**明确不引入**：Next.js / Nuxt（我们是单端口 Node 服务 + 自有 REST，不需要 SSR 与文件路由，且会显著增加 sites 沙箱适配成本）；Redux（状态量小）；Prisma/ORM（无自有 SQL 库）；Express/Fastify（8 个端点，现有 router 已够用，等 v2.0 需要 WebSocket 时再评估引入 `ws`）。

## 2. 为什么要换（判断依据）

### 2.1 前端：UI 复杂度即将越过"手写 DOM 临界点"

现有 `public/assets/app.js` 468 行，已经是**命令式**风格：`render()` 全量重绘 + `renderEvent()` 拼接 innerHTML + 手动 `addEventListener`。这套写法在单页对局时可控，但接下来三个版本要加的东西是：

- v1.4：大厅（列表 + 筛选 chips + 排序 + 分页）、观战页（上帝视角座位矩阵 + 身份标签）、投票可视化、死亡回顾
- v1.5：登录（手机号/邮箱 Tab + 验证码倒计时 + 两种 OAuth 跳转 + 错误态）、角色配置（人数联动、角色增减、人数不足禁用态）、战绩页
- v2.0：真人房（多人实时、房间列表、断线重连提示）

这些都是**多状态、多列表、带条件渲染**的界面。按当前写法估算会膨胀到 1500~2000 行 imperative DOM 代码，副作用与重绘时机将无法维护——典型症状是"改一个按钮导致别处输入框失焦"（v1.2.1 那个"点发言上屏 1"的 bug 就属于同一类根因：渲染分支优先级靠人肉维护）。

React 的收益不是"流行"，而是：**状态 → 视图的映射由框架保证**，发言面板 / 投票板 / 座位条这些会反复迭代的组件能被独立测试和替换。

### 2.2 后端：换 TS 但不换框架

- 游戏引擎 500 行状态机（夜晚口令流程、投票结算、胜负判定）是**最容易出隐蔽 bug** 的部分，类型能把"事件 kind 拼错""角色字段漏传"这类问题挡在编译期；
- 目前事件流 kind 全靠字符串约定（`night-cue` / `speech-order` / `vote-result` / `aborted`），前端 switch 分支写错不会报错——这正是 v1.2 那次"发言按钮退化"的土壤；
- 但**不引入 Web 框架**：`src/server/routes.js` 只有 8 个端点、146 行，已经清晰；换框架的收益（中间件生态）我们用不上，风险（迁移期引入新 bug）却是实打实的。

### 2.3 类型共享是这次迁移最大的实际收益

前端 `app.js` 与后端 `engine.js` 目前通过 JSON 字段名"口头契约"耦合。抽出 `src/shared/types.ts` 后：

```ts
// src/shared/types.ts —— 前后端唯一事实来源
export type EventKind =
  | 'game-start' | 'night-cue' | 'dawn' | 'speech'
  | 'speech-order' | 'vote' | 'vote-result' | 'game-over' | 'aborted'

export interface GameEvent { seq: number; kind: EventKind; at: number; payload: ... }
export interface Snapshot { matchId: string; round: number; phase: 'night'|'day'; ... }
export interface PublicSeat { id: string; name: string; emoji: string; alive: boolean; seat: number }
```

前端 `switch (e.kind)` 漏分支、后端新增事件忘同步，都会在 `tsc` 阶段报错。这比写文档有效。

## 3. 部署可行性（已核实）

sites 沙箱要求：**单端口 HTTP 服务、监听 `$PORT`、绑定 `0.0.0.0`**；支持 `installCmd` / `startCmd` 覆盖；官方文档明确支持 Vite/React 项目。

我们的做法（**不用 `vite preview` 当线上服务**，避免 allowedHosts 与代理头问题）：

```
npm run build        → dist/          （Vite 产出，文件名自带 hash，天然免缓存）
node src/server/index.js  → 监听 $PORT，同时提供 /api/* 与 dist/ 静态文件
```

- 部署参数：`installCmd: "npm install && npm run build"`，`startCmd: "npm start"`；
- 现有 `config/cloud.json` 三级查找逻辑保持不变（沙箱不注入自定义环境变量这一约束没有变）；
- 静态资源缓存问题一并解决：Vite 文件名 hash + `index.html` 禁缓存，**不再需要手写 `?v=` 参数**；
- 包体：React + ReactDOM 约 45KB gzip，对这个体量的应用无感。
- **版本约束**：本机 Node 是 v22，但部署沙箱的 Node 版本不由我们控制，而 `engines` 只承诺 `>=18`。因此依赖按 Node 18 兼容线选型——**Vite 5.x / 6.x（不取最新 8.x）+ React 18 + TS 5.x**，避免"本地能构建、沙箱起不来"。若 P0 阶段确认沙箱 Node ≥20，再升到 Vite 最新版。

## 4. 目标目录结构

```
werewolf-ai/
├── client/                     # 前端（Vite + React + TS）
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── pages/              # HomePage / LobbyPage / SetupPage / MatchPage / SpectatePage / LoginPage
│       ├── components/         # SeatStrip / SpeechBubble / VoteBoard / PromptPanel / RoleCard / ResumeBanner
│       ├── hooks/              # useMatchPolling / useEventStream / usePrompt / useLiveGames / useAuth
│       ├── api/                # REST 客户端（fetch 封装 + 共享类型）
│       ├── store/              # zustand：对局快照 + 事件列表 + UI 态
│       └── styles/
├── src/                        # 后端（Node + TS，ESM）
│   ├── game/                   # engine.ts / roles.ts / rules.ts
│   ├── ai/                     # llm-gateway.ts / ai-player.ts / json.ts
│   ├── server/                 # index.ts / routes.ts / rooms.ts
│   ├── cloud/                  # match-store.ts
│   └── shared/                 # types.ts（前后端共用，仅类型与常量）
├── tests/                      # vitest：json / engine( Mock LLM 10 局) / api 全链路
├── docs/
└── dist/                       # 构建产物（gitignore）
```

## 5. 迁移步骤（每步可回滚，线上 v1.3.1 不受影响）

| 阶段 | 内容 | 验收标准 | 预估 |
|---|---|---|---|
| **P0 工具链** | Vite+React+TS 骨架；后端 `.js→.ts`（ESM）；`tsc --noEmit` 通过；vitest 接管现有 3 个测试文件 | `npm run build && npm start` 起得来；`npm test` 全绿 | 1.5 天 |
| **P1 等价重建** | 对局页用 React 重写，行为与 v1.3.1 完全对齐（断线恢复、发言顺序、名字高亮、发言面板分支优先级） | 与线上逐条对照通过，无功能退化 | 1.5 天 |
| **P2 v1.4 功能** | 首页（含精选横滑）、大厅页、观战页、投票可视化、死亡回顾 | 按 06/04 原型验收 | 2–3 天 |
| **P3 v1.5 功能** | 登录（手机号 OTP 主 + 邮箱 + 微信 + WorkBuddy）、角色配置、战绩页 | PRD R3.1 / R4 验收 | 2–3 天 |
| **P4 v2.0** | 真人房：WebSocket（`ws`）、房间列表、重连 | 后续评估 | 待定 |

P0/P1 在 `refactor/react-ts` 分支进行，合并后一次性替换；期间线上继续跑 v1.3.1。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 迁移期功能退化 | P1 以"行为零变化"为唯一目标，先不掺新功能；用 v1.3.1 现状逐条对照 |
| CJS→ESM 触碰全部文件 | P0 一次性机械转换 + `tsc` 强校验 + 现有 3 个测试兜底；失败可整分支回滚 |
| 构建步骤拖慢部署 | `installCmd` 里串联 build；构建失败会以 `SITES_INSTALL_FAILED` 明确报出，不会静默降级 |
| 引入 React 后体积/首屏变慢 | 单页应用 ~45KB gzip；首屏只加载首页 chunk，对局页按路由懒加载 |
| 状态管理过度设计 | 只上 `zustand` 单 store（快照 + 事件 + UI），不引入 Redux/RTK Query |

## 7. 待确认项

1. 是否采纳本 ADR（React+TS 前端 / TS 后端、不上 Next.js）？
2. 迁移在 `refactor/react-ts` 分支进行，合并前线上版本冻结在 v1.3.1 —— 是否接受约 3 天不发新功能？
3. P0 完成后是否先发一版 `v1.4.0-rc`（功能等价、仅换栈）供你验证，再进 P2？

## 8. 执行记录（2026-10-22 落地）

| 项 | 计划 | 实际 |
|---|---|---|
| 前端 | React 18 + TS + Vite + Tailwind | React 18 + TS + Vite 已落地；**Tailwind 暂缓**——现有 175 行手写 CSS 已是成品视觉，直接换实用类会引入无收益的样式回归，待 v1.4 新增页面时再逐步引入 |
| 状态管理 | zustand 单 store | 已落地（`client/src/store/gameStore.ts`） |
| 后端 | TS + ESM，保留零框架 http | 已落地（`tsc` 输出 `dist-server`，Node 直接跑） |
| 类型共享 | `src/shared/types.ts` | 已落地；事件为可辨识联合（`{[K in EventKind]: {type:K; payload: EventPayloads[K]}}`），前端 switch 漏分支直接编译报错 |
| 测试 | vitest 统一 | 已落地；**测试不再依赖网络**：注入 Mock LLM，API 测试在进程内起服务 |
| 开发体验 | — | 新增 `npm run dev`（Vite HMR，`/api` 代理到 8787）与 `npm run dev:server`（tsx watch） |

**执行中顺带修掉的三个隐患**（都属于重构必要性的一部分）：

1. `game-start` 事件原先把真人完整快照（含 `myRole`）写进事件流，任何拿到 gameId 的人都能读到真人身份 → 改为只带 `gameId`；
2. 原 `await-human` 事件与快照里的 `pendingAction` 是两份状态，前端渲染靠"事件来了才出面板" → 事件移除，前端只从 `snapshot.pendingAction` 派生，消除"旧提示顶掉新面板"这一类 bug；
3. 前端发言名高亮原先走 `innerHTML` 拼接 → 改为 React 节点分段渲染，天然免疫注入。

**性能与体积**：前端产物 166KB / gzip 55.5KB；测试从 63s 降到 6.9s（引擎新增 `pace` 节奏系数，只压缩演出等待，不影响任何规则判定）。
