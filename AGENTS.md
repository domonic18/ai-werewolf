# AI 狼人杀 · Agent 补位局 — Agent 项目说明（AGENTS.md）

> 本文件是给任何编码 Agent 的项目说明书（跨厂商标准，Claude Code / WorkBuddy / CodeBuddy / Codex / Cursor 等均读取）。
> 内容以本文件为唯一事实源；各目录若有 `CLAUDE.md`，只写该目录的增量上下文，不重复本文件。
> 本文件的修改必须经人工确认（它决定 Agent 的行为边界）。

## 1. 项目概览

- **一句话**：6 人局狼人杀（1 位真人 + 5 个 LLM 智能体），对局中所有 AI 的发言与行动（杀谁、验谁、投谁）**全部由大模型实时生成**，不存在写死的话术或规则化决策。
- **形态**：网页游戏。移动端优先（390px 基准），深色金色主题。
- **线上**：WorkBuddy sites 部署，单端口 Node 服务；当前版本 v1.3.1。
- **背景**：WorkBuddy 1024 造物挑战参赛作品（截止 2026-11-01），同时是个人站点 17aitech.com 的流量产品。

### 三条不可动摇的产品红线

1. **禁止 hardcode AI 言行**。删掉任何兜底话术、降级发言、规则模板；LLM 调用失败时**明示原因中止对局**（fail-fast），不允许用假数据把界面填满。
2. **服务端权威**。所有身份、夜晚行动、随机数、胜负判定只存在于 Node 端。前端拿不到、也不能从任何接口推断出未公开信息（夜晚事件流不得出现玩家名 + 行为词）。
3. **配置不进仓库**。`config/cloud.json` 已 gitignore，仓库只留 `config/cloud.example.json` 模板。

## 2. 任务合同（specs）

- 需求合同在本仓库 `specs/` 目录（spec-kit 管理），每条需求含 `spec.md`（EARS 验收条款）/ `plan.md` / `tasks.md`，与代码同分支。
- **编码前必读**：对应的 `specs/<feature>/spec.md` 与 `tasks.md`。无合同不编码；合同变更随代码同一次提交。
- 产品需求的全景描述在 `docs/PRD.md`（R1~R7 + 角色库），技术选型决策在 `docs/TECH-STACK.md`。specs 是 PRD 的可执行切片，二者冲突时以 specs 为准并回写 PRD。
- 高保真原型在 `docs/designs/*.html`（浏览器可直接打开），对应 Ardot 设计文件 `739152426622950`。

## 3. 技术栈与项目结构

### 技术栈

- **运行时**：Node.js ≥ 18，ESM，原生 `http`，零 Web 框架
- **前端**：React 18 + TypeScript + Vite 5 + zustand（单 store）；样式为原生 CSS（Tailwind 暂缓，见 ADR 备注）
- **类型**：`src/shared/types.ts` 是事件/快照的唯一事实来源，前后端共用；`tsc` 是契约的守门人
- **AI**：WorkBuddy Cloud LLM（`@tencent-ai/workbuddy-cloud-sdk`，免密钥，服务端调用）
- **存储**：WorkBuddy Cloud Database（PostgREST 风格，`ww_matches` 表存档战绩）
- **测试**：vitest（单元 / 引擎冒烟 / 进程内 API 全链路），Mock LLM 不依赖网络
- **部署**：sites 单端口服务，`npm run build` 产出 `dist-server` + `dist/client`，由 Node 同时托管；绑 `0.0.0.0:$PORT`；沙箱不注入自定义环境变量

### 目录结构与职责

```
client/            前端（Vite + React + TS）
  src/pages/       HomePage / LobbyPage / MatchPage / ResultPage
  src/components/  纯展示组件（座位、顺序条、输入面板、发言记录、票型、阵营条、复盘时间轴…）
  src/hooks/       数据与轮询（useMatchPolling / useHomeData / useLobby）
  src/store/       zustand 单 store（快照 + 观战投影 + 事件 + 游标）
  src/api/         唯一 HTTP 入口（统一补 sharecode、统一错误映射）
  src/lib/         纯函数（高亮、阶段文案、舞台派生、票型、时间轴、URL、本地存档）
src/
  shared/          types.ts / roles.ts —— 前后端共用，只放类型与常量
  server/          index.ts（启动/配置/环境）、app.ts（装配/静态托管）、routes.ts、rooms.ts
                   llm-runtime.ts（AI 通道后台引导与重试）、lobby.ts（大厅投影/筛选/游标）
  game/            engine.ts（权威状态机：夜晚口令/发言轮次/投票结算/复盘时间轴/胜负）
                   roles.ts（角色牌组、AI 人设）、types.ts（引擎内部类型）
  ai/              llm-gateway.ts（模型选择、双流收集、JSON 约束、超时）
                   ai-player.ts（6 个决策点）、json.ts（JSON 提取、名字匹配）
  cloud/           match-store.ts（战绩表读写，staging 默认只读）
tests/             json / lobby / tally / timeline / format / url / engine-smoke / api-selftest / server-hardening / llm-runtime
tools/             ensure-build.mjs（产物兜底）、live-smoke.mjs（线上回归 20 项）、.ts 解析插件
docs/              PRD.md、TECH-STACK.md、DEPLOYMENT-STACK.md、CODE-REVIEW-*.md、REGRESSION-*.md、designs/（原型）
specs/             spec-kit 需求合同（001-lobby-spectate 已交付）
```

### 各目录 Agent 上下文

| 目录 | 说明 |
|------|------|
| `src/game/` | 规则唯一实现处。改动必须跑 10 局 Mock 冒烟，且通过夜晚隐私审计（事件流无身份泄露） |
| `src/ai/` | 提示词与决策契约。改 prompt 需保持 JSON 输出 schema 不变，或同步改 `json.ts` 与单测 |
| `client/` | 不许出现任何游戏规则判断；只允许「渲染 snapshot + 上报用户 action」。输入面板只从 `snapshot.pendingAction` 派生。观战与玩家用两套投影（`spectate` / `snapshot`），不许互相兜底 |
| `src/shared/` | 只放类型与展示常量。改这里等于改前后端契约，必须两端同时通过 `npm run typecheck`；新增事件类型必须登记进 `EventPayloads` |
| `tools/live-smoke.mjs` | 线上回归脚本。改接口契约后同步补断言——它验的是「发上去能不能用」，单测验不了网关层 |

## 4. 通用编码规范与 AI 指令

### 通用指令
- 先读相关文件再规划变更，管理好自己的上下文。
- 遵循 KISS / YAGNI / DRY；优先行业标准库而不是自研。
- 永远不要模拟、占位、省略代码。不能为了「让页面看起来能跑」编造数据。
- 有疑问时直说风险，不要为了讨好而附和。
- 副作用明确且最小化；状态变更可追踪。
- 未经用户明确同意不要 `git commit` / `git push`。
- 不要长期占用终端跑服务；需要验证时用进程内自测（`tests/api-selftest.test.js`），或告知用户自行启动。

### 文件组织
- 小文件、单一职责，单文件尽量 ≤ 350 行；超了就抽模块（常量、类型、纯函数）。
- 工具函数、常量、类型、业务逻辑分文件存放，不混在一个大文件里。
- 优先组合而非继承。

### 安全
- 不信任任何外部输入：`action` 的 `playerId`、`text`、`targetId` 必须在边界校验。
- 密钥只走环境变量或 `config/cloud.json`（不入库），代码里永不出现。
- 日志可记事件与错误，**不可记**身份、token、完整 prompt 中的私有信息。
- 夜晚阶段的任何响应、事件、日志都不得包含「谁在行动」的信息——这是游戏公平性的硬约束。

### 错误处理
- 使用具体错误类型（如 `llmFailure`、`abortOnLLMFailure`），不用裸 `throw new Error('failed')`。
- 面向用户的中止必须给出可读原因（模型不可用 / 输出不合法），不要静默降级。

### API 设计
- 薄路由、重服务：路由只做参数校验、状态码、异常转换；规则在 `engine.ts`。
- 一致的 JSON 响应格式；列表端点支持分页。
- 事件流用 `seq` 递增，客户端凭 `?since=` 增量拉取，天然支持断线恢复。

## 5. 任务完成协议

1. **测试**：`npm test` 必须全绿（解析器单测 + 10 局引擎冒烟 + API 全链路自测），另跑 `npm run typecheck` 与 `npm run build`。
2. **规则改动**：额外跑一遍「夜晚事件流隐私审计」，确认无玩家名 + 行为词共现。
3. **前端改动**：核对 390px 下的三屏流程（大厅 → 对局 → 结算），并手动确认无缓存残留（`no-cache` + 版本号）。
4. **版本号**：每次迭代 `package.json` +1（页面版本号由构建期从 `package.json` 注入，只改一处）。
5. **文档**：改了行为就更新 `specs/` 与 `docs/PRD.md` 中受影响的条目；不要新开重复文档。
6. 完成后向用户报告：改了什么、怎么验证的、还有什么风险。

## 6. 硬性禁止

- 禁止把「端口监听」放在任何外部依赖初始化之后。站点可用性不得依赖 AI 通道（2026-10-22 线上 504 事故：先 await LLM 初始化再 listen，冷启动自举死锁 → 整站 30s 超时）。LLM 一律后台引导，未就绪时 `/api/games` 返回 503。
- 禁止在 `client/` 里直接调用 `fetch('/api/...')`。必须走 `client/src/api/client.ts`——它负责带上平台要求的 `sharecode`（2026-10-22 事故：POST 不带分享码被网关 403，浏览器只报 `Failed to fetch`，而 curl 全绿）。
- 禁止凭 `.d.ts` 注释或猜测使用第三方 SDK 的字段名。调用前必须读**运行时实现**（编译产物里的方法体）：`@tencent-ai/workbuddy-cloud-sdk` 的类型声明与实现不一致（发码入参是 `{ phone }`，`phone_number`/`target` 只是它转发上游的请求体字段），照类型写会静默失败——2026-10 连续三次登录故障都出自这里。`tests/auth-actions.test.ts` 用假 SDK 钉住了这三条契约，改之前先看它。
- 禁止在 `client/` 里实现或复制任何游戏规则逻辑。
- 禁止为「体验兜底」加入规则化 AI 话术。
- 禁止把 `config/cloud.json`、`.env`、token 提交进仓库。
- 发布后必须核对线上 HTML 引用的 JS 文件名与本地 `dist/client/assets/` 一致。sites 沙箱目录是持久的，遗留的 `dist/` 会让「重新发布」发的是上一轮的旧包（2026-10 事故：改了代码页面不变，误判成浏览器缓存）。`tools/ensure-build.mjs` 因此每次启动都重建。
- 禁止擅自合并分支或改动线上部署配置。
