# 代码评审报告 · 2026-10-22

**范围**：`main`（`4faf861`）—— React 18 + TS 前端（`client/`）、Node TS 后端（`src/`）、vitest 测试（`tests/`）
**规模**：TypeScript 3,762 行（`client/` 1,293 + `src/` 2,469），测试 5 个文件 / 36 个用例
**方法**：全量阅读 + `tsc --noEmit` + `vitest run` + `vite build` + 针对性静态检查（角色分支分布、类型逃逸、仓库卫生）
**重点**：规范性、封装性、可扩展性

## 一、结论摘要

架构方向是对的：服务端权威、事件溯源、共享类型、LLM 后台降级都已落地，测试不依赖网络。主要债务集中在 **游戏引擎的单体化** 与 **角色能力的硬编码分支** —— 这两项恰好在 v1.5 加新角色（猎人/守卫/白痴…）之前必须处理，否则每加一个角色要改 5~8 处。

| 级别 | 数量 | 含义 |
|---|---|---|
| P0 阻断 | 3 | 会造成信息泄露、对局丢失或线上故障 —— **已全部修复（见第八节）** |
| P0-a 新增 | 1 | 观战者可替真人提交动作（无身份绑定），待定 |
| P1 规范性 | 6 | 违反自定规范或埋下维护成本，下轮修 |
| P2 可扩展性 | 11 | 不修也能跑，但每加一个功能/角色成本上升 |

评分（10 分制）：规范性 **6.5**、封装性 **7.5**、可扩展性 **6.0**。

## 二、P0：阻断项

### P0-1 观战者通过真人接口取快照，身份泄露到观战客户端

- 位置：`client/src/hooks/useMatchPolling.ts:36`（观战分支调用 `api.snapshot(gameId)`）、`src/server/routes.ts:141`（`/api/games/:id` 固定用 `engine.human.id` 取快照）
- 问题：观战页面为了拿玩家列表，调的是**玩家视角**接口，返回体里带 `myRole`、`seerChecks`、`witchPotions`。UI 不展示，但数据已经在观战者的浏览器里，打开 DevTools 就能看到这一局真人的身份。
- 影响：违反宪法第 II 条「信息隔离」。当前是 1 真人 + AI，泄露的是那位真人的身份；一旦 v2.0 上真人房，就是直接作弊入口。
- 修法：按 001 的 T014/T015 —— 新增 `engine.spectateSnapshot()`，`/spectate` 一并返回 `snapshot`（全量身份，观战专用投影），前端观战只调 `/spectate`，不再碰 `/games/:id`。两个投影函数物理分离。

### P0-2 房间数量到上限时会删掉**进行中**的对局

- 位置：`src/server/rooms.ts:96-100`
```ts
private gc(): void {
  for (const [id, room] of this.rooms) {
    if (room.expired || this.rooms.size > MAX_ROOMS) this.rooms.delete(id);
  }
}
```
- 问题：`expired` 只对已结束且超 2h 的房间为真；而 `this.rooms.size > MAX_ROOMS` 一旦成立，循环会**连续删除最早插入的房间**，不区分是否正在进行。第 21 局开局时，最早那局玩家会被静默踢出，刷新回来 404。
- 影响：多人同时玩时「对局凭空消失」，且没有任何提示。
- 修法：先只清理 `expired`；若仍超限，`create()` 返回 503「同时进行的对局已满，请稍后再试」，不要删活局。

### P0-3 静态资源 404 被兜底成 index.html（200）

- 位置：`src/server/app.ts:69-79`
- 问题：`serveStatic` 读文件失败后，无条件读 `index.html` 返回 200。请求 `/assets/index-abc123.js`（构建产物缺失或 hash 变了）会拿到 HTML，浏览器按 JS 解析直接报 MIME 错误，而服务端日志里看不到任何 404。
- 影响：构建异常被伪装成「页面白屏」，排障成本高（这次线上 504 排查就吃过类似亏）。
- 修法：只有「无扩展名 + `Accept` 含 `text/html`」的导航请求才回退；`/assets/*` 与带扩展名的路径一律 404。

## 三、P1：规范性问题

### P1-1 `engine.ts` 724 行，远超项目自定的 350 行上限

- 位置：`src/game/engine.ts`（`AGENTS.md` 第 72 行写的是「单文件尽量 ≤ 350 行」）
- 明细：`night()` 单方法 161 行（325-486），`day()` 85 行，另有 setup/snapshot/vote/结算。
- 影响：夜晚流程是最容易出规则 bug 的地方，现在「狼人/预言家/女巫」三段各含「真人分支 + AI 分支」，逻辑平铺在同一函数里，加一个角色就要在 161 行中间插入一段。
- 建议拆分：`engine/night.ts`（每个角色一个 `runNightStep`）、`engine/day.ts`（发言 + 投票）、`engine/votes.ts`（结算与平票）、`engine/snapshot.ts`（两个投影）。目标每文件 ≤ 200 行。

### P1-2 胜负判定有两套实现

- 位置：`src/game/engine.ts:687-700`（`checkEnd`）与 `src/game/roles.ts:38-44`（`judgeWinner`）
- 问题：`checkEnd()` 自己数狼/好人，`judgeWinner()` 又数一遍；`run()` 里 `this.winner = judgeWinner(...) ?? 'wolf'`（engine.ts:295）在超轮次时强行判狼胜，且不写日志。
- 建议：只保留 `judgeWinner()`，`checkEnd()` 调用它；maxRounds 兜底要 `log()` 一条「达到最大轮次，按场上人数判定」，否则复盘时看起来像凭空判负。

### P1-3 两处类型逃逸 `as unknown as`

- 位置：`src/ai/llm-gateway.ts:105`（流式 chunk）、`src/cloud/match-store.ts:59`（数据库 client）
- 问题：SDK 的 `ChatCompletionChunk` 与本地 `ChatChunk` 形状不一致就强转，SDK 升级后字段改名不会报错。
- 建议：为 chunk 写一个 `toDelta(chunk)` 适配函数（做字段存在性判断），DB 层保留但补注释说明「仅用链式查询子集」。

### P1-4 未知异常直接把 `e.message` 返回给客户端

- 位置：`src/server/routes.ts:196-199`
- 问题：`catch` 统一 `500 { error: e.message }`。数据库/内部错误的原文会透出去，可能包含表名、连接信息。
- 建议：已知领域错误（404/409/503）显式映射；其余记 `console.error` 并返回 `{ error: 'internal_error' }`。

### P1-5 无任何限流与写接口保护

- 位置：`POST /api/games`、`POST /api/models/select`（`src/server/routes.ts:127`、`:88`）
- 问题：每次开局会触发 20~40 次 LLM 调用，任何人循环调就能把积分打光；模型切换接口没有鉴权，访客可以把线上模型换成最贵的。
- 建议：按 IP 的简单令牌桶（开局 1 次/10s、模型切换仅限本地或带开关），失败返回 429 + `Retry-After`。

### P1-6 术语与命名不一致

- `gameId`（代码） vs `matchId`（ADR 与部分文档）；`aborted` 既是 `engine.aborted` 对象又是事件名；`playerId` 是 `number`，`clientId` 是 `string`，两者都叫 id。
- 建议在 `docs/` 加一页术语表（Game / Match / Room / Seat / Spectator），并统一到 `gameId`（代码已成型，改文档成本更低）。

## 四、P2：封装性与可扩展性

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| P2-1 | `src/game/engine.ts` 12 处、`src/ai/ai-player.ts` 3 处 `role === 'xxx'` | 角色能力靠 if 分支散落各处，加一个角色要改 5~8 处，且容易漏（比如忘加 `gameMates` 初始化） | 抽 `RoleBehavior` 注册表：`{ onAssign, nightStep, promptHint, onDeath }`，引擎只遍历「有夜间行动的角色」 |
| P2-2 | `src/server/routes.ts` | 单函数 200 行 if 链，新增端点靠继续加 if | 路由表 `[{ method, pattern, handler }]`；按资源拆 `routes/games.ts`、`routes/lobby.ts` |
| P2-3 | `client/src/pages/HomePage.tsx` 202 行 | 数据获取、模型选择、恢复横幅、战绩墙渲染混在一起 | 拆 `StartPanel` / `ModelSelect` / `LobbyPreview` / `MatchWall` 已在，继续拆 `ResumeGate` |
| P2-4 | `src/server/lobby.ts:52` | `maxPlayers = engine.players.length` —— 「上限」和「当前人数」写成了同一个值 | 引擎暴露 `capacity`（当前 6；v1.5 按人数配置） |
| P2-5 | `src/server/lobby.ts:56` | `isFinal: alive <= 3` 硬编码 | 移到 `GAME_RULES.finalThreshold`，与 spec 的 SC 对齐 |
| P2-6 | `src/shared/types.ts` 244 行 | 事件负载、快照、REST 契约堆在一个文件 | 拆 `shared/events.ts`、`shared/api.ts`、`shared/domain.ts`，`types.ts` 只做 re-export |
| P2-7 | `client/src/lib/stage.tsx:120-135` | `roleLabel()` 又手写了一遍角色名与 emoji | 直接复用 `@shared/roles` 的 `ROLES[key].name/emoji` |
| P2-8 | `client/` 无测试 | `highlight`、`stage.buildStage`、`gameStore.apply` 都是纯函数/纯状态，测试成本极低 | 每个补 3~5 个用例，vh 成本几乎为零，能锁住 v1.4 的 UI 回归 |
| P2-9 | `client/src/hooks/useHomeData.ts` | 无 in-flight 去重、无退避；AI 长时间不可用时每 3 秒打 4 个请求 | 指数退避（3→6→12→30s）+ 同一时刻只允许一个 refresh |
| P2-10 | `client/src/components/PromptPanel.tsx:8-14` | 5 条快捷话术内联在组件里 | 移到 `lib/quickLines.ts`，未来可按角色给不同话术（女巫/预言家视角不同） |
| P2-11 | `client/src/hooks/useMatchPolling.ts:33-40` | 观战每轮串行两个请求 | 001 的 `spectate` 一并返回 snapshot 后自然合并为一个请求 |

## 五、做得好的地方

1. **双投影的意识已经建立** —— `snapshot(forPlayerId)` 明确用 `null` 表达"不可见"，并在注释里写了「与观战投影是两个函数，禁止合并」。（P0-1 是调用方走错了门，不是设计错。）
2. **事件类型是可辨识联合** —— `EventPayloads` 映射 + `{[K in EventKind]: {...}}`，前端 `switch` 漏分支编译期就报错，这条比文档纪律有效。
3. **LLMRuntime 的降级设计** —— 先监听再初始化，失败退避重试，`/api/games` 503 带人话，`/health` 区分四态。这是从真实事故里长出来的设计。
4. **测试工程化** —— Mock LLM 注入 + `pace` 系数，10 局冒烟 1.3s、全量 37 用例 5.5s；`tests/llm-runtime.test.ts` 把"AI 挂了站点也得活"锁成回归用例。
5. **配置分层克制** —— env → `config/cloud.json`（gitignore）→ 部署配置，仓库里只有 `cloud.example.json`，`git ls-files` 验证无密钥入库。
6. **文件粒度整体健康** —— 除 engine（724 行）外，其余文件集中在 40~250 行，`routes.ts` 200、`lobby.ts` 157、`rooms.ts` 102，职责边界清楚。

## 六、建议的修复顺序

| 轮次 | 内容 | 预估 |
|---|---|---|
| 第一轮 | P0-1 / P0-2 / P0-3（三个都是小改动，但影响最大） | 0.5 天 |
| 第二轮 | P1-1 拆 engine + P2-1 角色能力注册表（为 v1.5 新角色铺路，必须一起做） | 1 天 |
| 第三轮 | P1-4 错误映射 + P1-5 限流 + P2-2 路由拆分 | 0.5 天 |
| 第四轮 | P2-8 前端测试 + P2-7/P2-10 清理 + P2-6 类型文件拆分 | 0.5 天 |

**优先做第二轮的理由**：v1.5 要加猎人、守卫、白痴、长老、黑狼王、摄梦人六个角色。按现在的写法，每个角色要在 `engine.night()` 里插一段、在 `ai-player.privateBrief()` 里加一段、在 `snapshot()` 里加一个私有字段、在 `setup()` 里加初始化 —— 六个角色就是 24+ 处改动。注册表化之后，每个角色只加一个文件。

## 七、检查清单（本次评审实测）

- `npm run typecheck`：通过（前后端）
- `npm test`：36 用例 / 5 文件全绿（json 13、lobby 12、engine 3、api 4、llm-runtime 4）
- `npm run build`：通过，前端 167KB / gzip 55.9KB
- `git ls-files | grep -i cloud`：仅 `cloud.example.json` 与 `match-store.ts`，无密钥
- 前端测试文件：0 个（P2-8）


## 八、P0 修复记录（2026-10-22 16:36）

三项阻断问题已修复并补回归用例，`npm test` 从 36 → 44 个用例全绿。

### 修复 1：观战改用独立投影（P0-1）

- `src/game/engine.ts` 新增 `spectateSnapshot()`：全量 `role` / `camp`、阵营存活统计；刻意不含 `pendingAction`，与 `snapshot()` 物理分离
- `src/server/routes.ts` 的 `/spectate` 返回 `snapshot`（上帝视角）+ `spectators`
- 前端观战不再调用 `/api/games/:id`：`useMatchPolling` 只打一个 `/spectate` 请求（顺带解决了 P2-11 的双请求）
- 前端 `gameStore` 增加 `spectate` 分支；`MatchPage` 按 `watching` 选择数据源，`SeatGrid` 增加 `revealRoles`
- 回归用例：`tests/server-hardening.test.ts` —— 玩家快照不含 `role`/`camp`/`factions`；观战快照每个座位都有身份且阵营总数正确（2 狼 4 好）

### 修复 2：房间满时拒绝新建，不再删活局（P0-2）

- `RoomManager.create()` 改为返回 `Room | null`，只 `prune()` 已结束且超 TTL 的房间；`maxRooms` 可注入
- `/api/games` 拿到 `null` 时返回 503「同时进行的对局已满…」，不踢人
- 回归用例：`maxRooms=2` 时第三局被拒且前两局仍在；已结束 + 超 TTL 的房间会被清理腾位

### 修复 3：静态 404 不再伪装成 200（P0-3）

- `serveStatic` 的回退条件收紧为「无扩展名 + `Accept: text/html`」；`/assets/*` 与带扩展名路径一律 404
- 回归用例：`/assets/index-deadbeef.js` → 404 `text/plain`；`/missing.png` → 404；`/some/deep/link`（导航）→ 200 回 index.html

### 待定：P0-a 观战者可替真人提交动作

`POST /api/games/:id/action` 目前只判断「有没有挂起点」，没有身份校验。大厅把 `gameId` 公开之后，任何拿到 id 的人都能替真人确认、投票、发言——这在单人局里已经是公平性问题，真人房会变成作弊入口。

建议方案（未实施，需改契约）：开局返回一次性 `playerToken`（随机 32 字节，服务端存在 `Room` 上），`/action`、`/quit` 校验 token，不匹配返回 403；前端把 token 存进 `sessionStorage`（刷新可恢复，不跨设备）。工作量约 0.5 天，含前端的错误态与断线恢复路径。
