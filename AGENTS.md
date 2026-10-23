# AGENTS.md · 项目规范

> 这是**给编码 Agent 的唯一行为规范**（Claude Code / WorkBuddy / CodeBuddy / Codex / Cursor 都读这个文件）。
> 事实源分工：产品与范围看 `docs/PRD.md`，视觉看 `docs/standard/DESIGN-V2.md`，安全看 `docs/standard/SECURITY.md`，
> AI 行为看 `docs/AI-PERSONA.md`。本文件只规定「怎么干」，不重复「做什么」。
> 各子目录若出现 `CLAUDE.md`，只写该目录的增量约定，不得复述本文件。
> **改本文件需要人工确认**——它决定 Agent 的行为边界。

---

## 1. 项目速览

| 项 | 值 |
|---|---|
| 一句话 | 一个人也能打的狼人杀：1 位真人 + 5 个 LLM 智能体，发言、投票、刀人、验人全部由大模型实时生成 |
| 形态 | 网页应用，移动优先（390 基准），暖黑 + 旧黄铜；6~12 人局，最多 8 轮 |
| 线上 | `https://werewolf-ai-01048.app.workbuddy.host/?sharecode=2IBHTRFFFL`（WorkBuddy sites，单端口 Node） |
| 版本 | 以 `package.json` 为准（构建期注入 `__APP_VERSION__`，页脚显示），**不在别处写死** |
| 目标 | 1024 造物挑战参赛（2026-11-01 截止）+ 长期作为 17aitech.com 的流量产品 |

---

## 2. 四条红线（违反即返工）

1. **AI 言行必须由模型生成**。禁止兜底话术、规则模板、"没拿到就用示例填"。模型失败就**明确中止并说原因**（fail-fast）。
2. **服务端权威**。身份、夜间行动、随机数、胜负判定只存在于 `src/game/engine.ts`。前端只能拿到投影，任何接口都不得泄露未公开信息。
3. **身份只走一条路**。用户 token 由客户端放在 **`X-WW-Token`** 头里（`Authorization` 会被平台网关覆盖，见 §12-①），服务端用 `readAccessToken()` 读取，交给云端 `/user/me` 实打实认人；认不出就降级匿名，绝不猜。
4. **配置不入库**。`config/cloud.json`、`.env*`、证书私钥只在本地；仓库只留 `config/cloud.example.json`。

---

## 3. 事实源地图（改之前先看对应那份）

| 想知道 | 看这里 |
|---|---|
| 做什么、不做什么、版本路线图、决策与残留风险 | `docs/PRD.md`（R1~R8） |
| 颜色 / 字体 / 圆角 / 图标 / 动效 / 文案语气 | `docs/standard/DESIGN-V2.md` |
| 信任边界、接口防线、已知可作弊路径 | `docs/standard/SECURITY.md` |
| AI 的信息边界、人格参数、记忆窗口 | `docs/AI-PERSONA.md` |
| 文档索引与写作约定 | `docs/README.md` |
| 需求合同（用户故事 + 验收条款） | `specs/*/spec.md` |
| 设计稿（原型、可量取） | Ardot 文件 `739278326396024` |

**文档纪律**：同一结论只写一处，其它地方引用。过程性产物（评审稿、任务清单、逐版本回归记录）完成后并入 PRD，不留档。

---

## 4. 技术栈

- **运行时**：Node.js ≥ 18，ESM，原生 `http`（零 Web 框架）
- **前端**：React 18 + TypeScript + Vite 5 + zustand 单 store；原生 CSS（不引 UI 库）
- **契约**：`src/shared/types.ts` 是事件/快照的唯一事实源，前后端共用；`tsc` 是守门人
- **AI**：WorkBuddy Cloud LLM（SDK 服务端调用，免密钥）
- **存储**：WorkBuddy Cloud Database（PostgREST 风格，`ww_matches` 记战绩）
- **测试**：vitest（单元 / 引擎冒烟 / 进程内 API 全链路），Mock LLM 不依赖网络
- **部署**：`npm run build` → `dist-server` + `dist/client`，由 Node 同时托管，绑 `0.0.0.0:$PORT`

---

## 5. 目录与职责

```
client/src/
  pages/        HomePage / LobbyPage / SetupPage / LoginPage / MePage / MatchPage / ResultPage
  components/   Avatar / Icon / SiteFooter / AccountCard / NightCurtain / RoundTimeline（纯展示）
  hooks/        useMatchPolling（轮询，含流式加速）/ useHomeData / useLobby
  store/        gameStore（快照 + 观战投影 + 事件 + live + 游标）
  api/          client.ts：唯一 HTTP 出口（补 sharecode、带身份头、错误归一）
  lib/          format / highlight / night / sound / stage / tally / timeline / url / storage / nickname / clientId
src/
  shared/       types.ts（契约）/ roles.ts（角色元数据）
  server/       index.ts（启动与配置）/ app.ts（装配与静态托管）/ routes.ts（薄路由）
                rooms.ts / lobby.ts（大厅投影）/ identity.ts（云端认人）/ auth.ts（token 读取）
                llm-runtime.ts（后台引导与重试）/ rate-limit.ts（限流）
  game/         engine.ts（权威状态机）/ catalog.ts（角色库与推荐牌组）/ behaviors.ts（角色夜间行为）
  ai/           llm-gateway.ts（模型选择 / 流式 / JSON）/ ai-player.ts（决策点）/ speech-stream.ts（增量抽 speech）
  cloud/        match-store.ts（战绩读写）
tests/          28 个文件：引擎、隐私、认证、限流、契约、仓库卫生
tools/          ensure-build.mjs / live-smoke.mjs（线上 24 项）/ screens.mjs（截图）/ repo-check.mjs（仓库卫生）
                ardot-export.mjs / design-outline.mjs
docs/           PRD / standard（DESIGN-V2、SECURITY）/ AI-PERSONA / README / screenshots
specs/          需求合同（只放 spec.md）
```

---

## 6. 服务端规范

- **薄路由，重引擎**：`routes.ts` 只做参数校验、状态码、异常转换；规则一律在 `engine.ts`。
- **两个投影物理分离**：`snapshot(humanId)`（玩家，藏身份）与 `spectateSnapshot()`（上帝视角，亮身份）。**禁止合并、禁止互相兜底**。
- **事件流**：`seq` 递增，客户端凭 `?since=` 增量拉取——断线恢复靠这个，不要改成「重发全量」。
- **实时状态不进事件流**：AI 发言的流式文本放在 `engine.liveSpeech`，通过响应里的 `live` 字段下发（一段发言上百个增量，写进事件流会挤爆客户端 500 条上限）。
- **认人顺序**：`readAccessToken()`（`X-WW-Token` 优先）→ 云端 `/user/me`（必须带 `x-wb-webapp-access-key` 与 `Origin`）→ 失败即匿名。`verify` 短缓存、401 负缓存 10s，5xx 不缓存。
- **限流与边界**：开局、动作、读接口分别限流；请求体有上限；错误用具体类型（`llmFailure`、`HttpError`），不用裸 `throw new Error('failed')`。
- **日志**：可记事件、耗时、错误码；**不可记** token、身份、完整 prompt 私有段。

---

## 7. 前端规范

- **只渲染 + 上报动作**：`client/` 不得出现任何规则判断；输入面板只从 `snapshot.pendingAction` 派生。
- **网络只走 `api/client.ts`**：它统一补 `sharecode`、带 `X-WW-Token`、把非 JSON 响应翻译成能读懂的错误。
- **样式只用令牌**：颜色/字号/圆角取 `app.css` 的 CSS 变量，不写裸值；图标来自 `Icon.tsx`，人物头像来自 `Avatar.tsx`，**不用 emoji**。
- **状态归 store**：分屏切换走 hash（`#lobby` / `#setup` / `#login` / `#me` / `#watch=<id>`），刷新要能回到原屏。
- **移动端**：390 宽为基准，注意安全区与键盘顶起；`prefers-reduced-motion` 下关动效。

---

## 8. AI 层规范

- **信息边界写死在 prompt 构造里**：AI 只知道自己的身份与技能状态，狼人额外知道队友；别人的身份只有被放逐翻牌才公开。禁止把 `spectateSnapshot()` 的数据喂给 AI。
- **输出必须是 JSON**：`{"speech","vote","reason"}` 这类 schema 由 `json.ts` 提取；改 schema 必须同步改单测与调用方。
- **流式只在需要上屏的地方用**：`streamTask` 配 `extractSpeechSoFar`（从未闭合 JSON 抽 `speech`）；决策类（刀谁、验谁）用普通 `task`。
- **人格差异落到机制**：记忆窗口、可推理深度、字数区间、采样温度随 traits 变化，不靠「你要像新手」这种话术。
- **失败即中止**：模型不可用 / 输出不合法 → 抛 `llmFailure`，引擎中止并给出可读原因。

---

## 9. 数据与隐私

- 战绩表 `ww_matches`：`owner_id` 有值即归属账号，`null` 表示匿名局（战绩墙照常展示）。
- 玩家角色字段 `player_role` 存的是**中文名**（`狼人` / `黑狼王` / `村民`），判断阵营要按 `ROLES.team` 反查，不能拿 `'wolf'` 直接比。
- 只返回本人可见的**聚合**数据（局数、胜率），不做跨账号明细查询。邀请关系（`ww_profiles` / `ww_invites`）落地时同样遵守。
- staging 默认只读战绩（`WB_WRITE_MATCHES=1` 才写），避免联调数据污染生产。

---

## 10. 测试与验收

改完必须全绿，命令按顺序：

```bash
npm run typecheck    # 前后端类型（契约守门人）
npm test             # 28 个文件 / 245 个用例：引擎 / 隐私 / 认证 / 限流 / 契约 / 仓库卫生
npm run build        # 产出 dist-server + dist/client
npm run repo:check   # 没有垃圾、密钥、构建产物被跟踪
npm run smoke:live   # 发版后必跑：对线上实例 24 项（失败退出码非 0）
npm run screens      # 改了 UI 才跑：生成 docs/screenshots 六屏
```

- **规则改动**额外跑「夜晚隐私审计」：事件流里不得出现玩家名 + 行为词共现。
- **新增接口**先过 `docs/standard/SECURITY.md` 文末清单，并补至少一条「攻击路径被拒绝」的用例。
- **测试要能证伪**：断言写具体值，不做「不等于 null」这类弱断言；偶发用例必须修成确定性（曾有一条女巫毒杀目标写死，20 局撞不到猎人的偶发失败）。

---

## 11. Git、版本与发布

- **提交粒度**：一个改动一个提交，消息写「为什么」而不只是「改了什么」；不要把删除与功能混在同一提交里。
- **版本号**：每次迭代升一位（`npm version patch --no-git-tag-version`），页面版本号自动跟随，别在代码里写死。
- **发布后校验**：核对线上 HTML 引用的 JS 文件名与本地 `dist/client/assets/` 一致；`tools/ensure-build.mjs` 每次启动重建，防止发到上一轮旧包。
- **不擅自**合并分支、改线上部署配置、强推。

---

## 12. 硬性禁止（每条都对应一次真实事故）

1. **禁止用 `Authorization` 传用户 token**。平台网关会用自己的凭据覆盖它——实测发出的 `Bearer AAAA` 到服务端哈希对不上，导致账号体系静默失效。用户 token 一律走 `X-WW-Token`。
2. **禁止服务端调云端 `/user/me` 时漏掉 `Origin`**。会话按 appId + Origin 绑定，缺了会被当成另一个客户端，回 `invalid_grant`，表现是「刚登录却提示登录态失效」。
3. **禁止在客户端缓存 access token 当长期凭证**。续期只能由 SDK 发起（`getAccessToken()` / `refreshSession()`），过期后服务端只会认成匿名。
4. **禁止把端口监听放在任何外部依赖初始化之后**。站点可用性不依赖 AI 通道（504 事故：先 await LLM 再 listen，冷启动自举死锁）。LLM 一律后台引导，未就绪时 `/api/games` 返 503。
5. **禁止在 `client/` 里直接 `fetch('/api/...')`**。必须走 `api/client.ts` 补 sharecode（POST 不带分享码被网关 403，浏览器只报 `Failed to fetch`，curl 却全绿）。
6. **禁止凭 `.d.ts` 注释使用第三方 SDK 字段**。必须读运行时实现：`sendOtp` 只认 `{phone}` / `{email}`，传 `phone_number` 会静默失败。`tests/auth-actions.test.ts` 钉住了这几条契约。
7. **禁止用「看起来能跑」的数据糊界面**。没有数据就写空态，不要编。
8. **禁止提交密钥、`config/cloud.json`、`.env*`、证书**。一旦进了历史，删文件不够，要先作废凭据再改历史。
9. **禁止新增重复文档**。要加就并入既有事实源；过程性文档不留档。
10. **禁止把 AI 发言增量写进事件流**。用 `live` 字段，事件流上限 500 条。

---

## 13. Agent 工作流

1. **认路**：读 `docs/PRD.md` 对应 R 段 + 相关 `specs/*/spec.md` + 要改的文件本身（先读再改，别猜）。
2. **定位**：判断改动落在哪层——规则进 `engine.ts`，展示进 `client/`，契约进 `shared/types.ts`。跨层就拆开做。
3. **实现**：小步、单一职责，单文件尽量 ≤ 350 行；不为「将来可能」预留抽象。
4. **验证**：按 §10 跑命令；UI 改动看 390 宽截图；不确定的取舍说出来，不要硬编。
5. **交付**：报告「改了什么 / 怎么验证的 / 还有什么风险」，不夸大、不隐瞒没做的部分。

---

## 14. 本文件的维护

- 结构性变化（新增目录、新增命令、新增红线）必须同一次提交里更新本文件。
- 删规则要写清原因，不要悄悄移除——后来的 Agent 会重复踩坑。
- 这份文件是**规范**，不是日志：事故背景压成一句，详细复盘进 `docs/standard/SECURITY.md` 或 PRD 的「工程决策与风险」。
