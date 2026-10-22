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

- **运行时**：Node.js ≥ 18，原生 `http`，零 Web 框架（8 个端点，够用）
- **前端**：当前为原生 HTML/CSS/JS（`public/`），v1.4 起按 ADR 迁移 React 18 + TypeScript + Vite + Tailwind
- **AI**：WorkBuddy Cloud LLM（`@tencent-ai/workbuddy-cloud-sdk`，免密钥，服务端调用）
- **存储**：WorkBuddy Cloud Database（PostgREST 风格，`ww_matches` 表存档战绩）
- **部署**：sites 单端口服务，绑 `0.0.0.0:$PORT`；沙箱不注入自定义环境变量

### 目录结构与职责

```
src/
  server/       HTTP 层：index.js（静态文件 + 配置加载）、routes.js（REST 路由）、rooms.js（内存房间管理，TTL 2h）
  game/         engine.js（权威对局状态机：夜晚口令/发言轮次/投票结算/胜负判定）
                roles.js（角色定义、6 人角色组、AI 人设阵容）
  ai/           llm-gateway.js（模型选择、双流收集、JSON 约束、超时）
                ai-player.js（5 个决策点：发言/狼刀/查验/女巫用药/投票/首夜遗言）
                json.js（括号深度扫描提取 JSON、玩家名匹配）
  cloud/        match-store.js（战绩表读写）
public/         前端（薄客户端：只渲染状态，零游戏逻辑）
tests/          json.test.js（解析器单测）、engine-smoke.test.js（Mock LLM 10 局）、api-selftest.test.js（进程内全链路）
docs/           PRD.md、TECH-STACK.md、designs/（原型）
```

### 各目录 Agent 上下文

| 目录 | 说明 |
|------|------|
| `src/game/` | 规则唯一实现处。改动必须跑 10 局 Mock 冒烟，且通过夜晚隐私审计（事件流无身份泄露） |
| `src/ai/` | 提示词与决策契约。改 prompt 需保持 JSON 输出 schema 不变，或同步改 `json.js` 与单测 |
| `public/` | 不许出现任何游戏规则判断；只允许「渲染 snapshot + 上报用户 action」 |

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
- 薄路由、重服务：路由只做参数校验、状态码、异常转换；规则在 `engine.js`。
- 一致的 JSON 响应格式；列表端点支持分页。
- 事件流用 `seq` 递增，客户端凭 `?since=` 增量拉取，天然支持断线恢复。

## 5. 任务完成协议

1. **测试**：`npm test` 必须全绿（解析器单测 + 10 局引擎冒烟 + API 全链路自测）。
2. **规则改动**：额外跑一遍「夜晚事件流隐私审计」，确认无玩家名 + 行为词共现。
3. **前端改动**：核对 390px 下的三屏流程（大厅 → 对局 → 结算），并手动确认无缓存残留（`no-cache` + 版本号）。
4. **版本号**：每次迭代 `package.json` 与页面 `#ver` 同步 +1（v1.3.1 → v1.4.0），便于线上验证。
5. **文档**：改了行为就更新 `specs/` 与 `docs/PRD.md` 中受影响的条目；不要新开重复文档。
6. 完成后向用户报告：改了什么、怎么验证的、还有什么风险。

## 6. 硬性禁止

- 禁止在 `public/` 里实现或复制任何游戏规则逻辑。
- 禁止为「体验兜底」加入规则化 AI 话术。
- 禁止把 `config/cloud.json`、`.env`、token 提交进仓库。
- 禁止擅自合并分支或改动线上部署配置。
