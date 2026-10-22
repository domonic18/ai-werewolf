# Implementation Plan: 游戏大厅与对局观战

**Branch**: `001-lobby-spectate` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-lobby-spectate/spec.md`

## Summary

把现有「只能开局、观战只有裸事件流」的形态，升级为「大厅可发现、观战可读懂、隐私不破防」的只读链路。

三件事：

1. **大厅数据契约扩展**——`/api/live` 补齐观战人数、阶段标签、存活比、筛选、稳定分页，支撑 100 局规模的列表；
2. **观战投影**——新增 `spectateSnapshot()` 与观战会话计数，观战者拿到全量身份的脱敏投影，写操作一律 403；
3. **局势可视化数据**——票型（由事件推导）、阵营存活统计、每晚时间轴，供对局页与观战页共用。

**不做什么**：不做登录、不做 WebSocket、不做真人房、不做观战延迟（Q3 待确认，仅在契约中预留 `visibleAt`）。

## Technical Context

**Language/Version**: Node.js ≥ 18（CommonJS，原生 `http`）；前端原生 HTML/CSS/JS

**Primary Dependencies**: 零新增。仅 `@tencent-ai/workbuddy-cloud-sdk`（已有，本特性不新增 LLM 调用）

**Storage**: 内存房间（`src/server/rooms.js`，TTL 2h）；历史战绩仍走 `ww_matches`，本特性不写库

**Testing**: `node tests/run-all.js` 三层（json 单测 / engine 10 局冒烟 / 进程内 API 自测）

**Target Platform**: 单端口 Node 服务（WorkBuddy sites），移动端浏览器 390px 基准

**Project Type**: Web 应用（BFF + 权威游戏引擎）

**Performance Goals**: 大厅 100 局时单次请求 P95 < 300ms；观战事件端到端 P95 < 2s（轮询 1.2s）

**Constraints**: 观战零身份泄露给玩家；观战不增加 LLM 调用；不改动既有 `action` 语义

**Scale/Scope**: 目标 ≤ 100 并发房间、单局 ≤ 12 人；观战者按每局 ≤ 50 计

## Constitution Check

*GATE: 必须通过后才进入实现。*

| 宪法条款 | 本方案的落实 | 结论 |
|---|---|---|
| I. LLM 单一事实源 | 本特性**不新增任何 AI 决策点**，不引入话术模板；观战只读既有事件 | ✅ |
| II. 服务端权威与信息隔离 | 新增独立 `spectateSnapshot()`，与玩家 `snapshot()` 物理分离；观战写操作 403；夜间事件不含行动明文 | ✅（需专项断言） |
| III. 规范先行 | 本 spec + plan + tasks 即合同，契约变更同步本目录 | ✅ |
| IV. 三层可验证性 | 新增：大厅分页/筛选不变量、观战隐私断言、观战写 403、票型与事件一致性 | ✅ |
| V. 版本可追溯 | 版本 v1.4.0；`/api/live` 字段只增不删；`/spectate` 响应兼容旧客户端（保留 `events`，新增 `snapshot`） | ✅ |
| VI. 开源卫生 | 无新增配置项、无凭据 | ✅ |

**复杂度辩护**：为什么不直接复用 `snapshot(forPlayerId)` 传 `undefined`？因为玩家投影的"null 掉私有信息"逻辑与观战投影的"全量公开"逻辑方向相反，混在一个函数里必然出隐私事故。两个函数、两套测试，是这里唯一安全的做法。

## Phase 0：研究结论（Research）

| 问题 | 结论 | 依据 |
|---|---|---|
| 观战者身份可见性 | 观战必须**全量可见**，否则"上帝视角"名不副实 | PRD R3.2 + 原型 04 |
| 玩家与观战共用一个投影函数？ | **不能**。缺失字段与全量字段是互斥语义，合并会制造泄露面 | 现有 `snapshot()` 已用 `null` 表达"不可见"，语义过载 |
| 分页用 offset 还是游标？ | **游标**。列表按观战人数排序，人数实时变化会导致 offset 翻页重复/漏项（FR-002） | 排序键不稳定时 offset 不可用 |
| 观战人数从哪来？ | 服务端记录观战会话（`clientId` + `lastSeenAt`，30s 无心跳剔除），不信任客户端计数 | 防止刷榜与虚高 |
| 票型是否需要引擎新增状态？ | **不需要**。票型可由 `vote` 事件推导，保持引擎单一事实源，避免"状态与事件不一致" | 事件溯源原则 |
| 每晚时间轴存哪？ | 引擎内累积 `timeline[]`（夜序号、死者、死因、是否被救/守），随 `game-over` 与观战快照下发 | 现只有 `publicLog` 文本，不够结构化 |
| 观战延迟 | Q3 未定；契约预留 `visibleAt`（默认等于 `t`），不实现延迟逻辑 | 避免在未定需求上写死行为 |

## Phase 1：契约与数据模型

### API 契约变更（只增不删）

**GET `/api/live`**（大厅）

```jsonc
// 请求：?filter=all|human|final&sort=spectators|created&limit=10&after=<opaque>
{
  "games": [{
    "gameId": "g_xxx",
    "host": "你",
    "players": 6, "maxPlayers": 6,
    "alive": 4,
    "phase": "day", "phaseLabel": "第 2 天 · 投票",
    "round": 2,
    "spectators": 12,
    "hasHuman": true,
    "isFinal": false,
    "startedAt": 1761111111111,
    "spectatable": true
  }],
  "nextCursor": "eyJzIjoxMiwidCI6MTc2MTExMTExMTExMSwiaWQiOiJnX3h4In0", // null 表示到底
  "total": 128
}
```

- 排序：`spectators` 降序（默认）/ `created` 降序；同值以 `gameId` 升序兜底，保证游标稳定。
- 游标编码：`base64({s:sortValue, t:startedAt, id:gameId})`，服务端解码后做 `(sortValue, id) < (last)` 过滤。
- 过滤：`human` = 房主为真人；`final` = `alive ≤ 3`。
- 不可观战（`phase==='over'`、`aborted`）一律不返回（FR-006）。

**GET `/api/games/:id/spectate`**（观战，只读）

```jsonc
// 请求：?since=N&client=<uuid>
{
  "version": 42,
  "events": [ /* 与旧契约完全一致 */ ],
  "snapshot": {            // 新增字段（旧客户端忽略即可）
    "gameId": "g_xxx", "phase": "night", "round": 2,
    "players": [{ "seat":1, "name":"老K", "emoji":"🕶️", "alive":true, "role":"wolf", "camp":"wolf" }],
    "factions": { "wolf": { "alive":2, "total":2 }, "good": { "alive":2, "total":4 } },
    "tally": { "3": 2, "5": 1 },          // 由 vote 事件推导
    "timeline": [ { "night":1, "deaths":[{"seat":4,"name":"豆豆","cause":"wolf","saved":false} ] } ],
    "visibleAt": 1761111111111            // 预留：观战延迟用，当前等于事件 t
  },
  "spectators": 12
}
```

**GET `/api/games/:id`**（玩家视角）新增只读字段：`tally`、`factions`（不含他人身份）。

**任何 `/api/games/:id/action|quit` 携带观战者标识** → 403 `{ error: 'spectator is read-only' }`。

### 数据模型

| 实体 | 位置 | 关键字段 | 生命周期 |
|---|---|---|---|
| `Room` | `src/server/rooms.js` | `id`、`engine`、`createdAt`、`spectators: Map<clientId, lastSeenAt>` | 2h TTL；观战者 30s 无心跳剔除 |
| `SpectatorProjection` | `src/game/engine.js` 新增 `spectateSnapshot()` | 全量身份、阵营统计、票型、时间轴 | 每次请求实时计算，不缓存 |
| `TimelineEntry` | `src/game/engine.js` 内 `this.timeline[]` | `night`、`deaths[{seat,name,cause,saved,guarded}]` | 随对局生死，随 `game-over` 下发 |
| `LobbyCursor` | `src/server/lobby.js`（新增） | `sortValue`、`startedAt`、`gameId` | 无状态，随请求传递 |

## Phase 2：实现结构

```
src/
  server/
    lobby.js        # 新增：房间 → LobbyEntry 投影、筛选、排序、游标编码/解码
    routes.js       # 改：/api/live 走 lobby.js；/spectate 增加 snapshot + client 登记；写操作拒绝观战者
    rooms.js        # 改：spectators 心跳登记/剔除；archive 时清理
  game/
    engine.js       # 改：新增 spectateSnapshot()、timeline 累积、tallyOf()；snapshot() 增补 tally/factions
  ai/               # 不动（本特性零 AI 变更）
public/
  assets/
    lobby.js        # 新增：大厅列表渲染（筛选/排序/上滑加载/空态）
    spectate.js     # 新增：观战视图（身份卡/阵营条/票型/时间轴）
    state.js        # 新增：极薄 store（订阅式），为 v1.5 迁 React 留缝
    app.js          # 改：拆分对局页渲染，接入 state.js
tests/
  lobby.test.js     # 新增：筛选/排序/游标分页不变量（纯函数，无需起服务）
  api-selftest.test.js  # 改：新增观战隐私、观战写 403、大厅分页全链路
  engine-smoke.test.js  # 改：断言 timeline 与 tally 不变量（不为空、得票总数 = 存活人数）
```

**前端迁移兼容**：新增的 `state.js` 只做 `{ get, set, subscribe }`，渲染函数为纯函数 `render(state) → DOM 更新`。v1.5 若通过 React ADR，只需把这批纯函数改成组件，不改契约。

## 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 观战投影与玩家投影串号 | P0 信息泄露 | 两个函数物理分离 + 专项断言（观战快照能查到他人身份；玩家快照查不到） |
| 游标分页在排序键抖动时漏项 | 列表体验 | 排序键含 `gameId` 兜底；测试构造同观战人数的 30 局验证无重无漏 |
| 观战者心跳放大内存 | 内存占用 | 每局 ≤ 50 上限；30s 剔除；房间 2h 回收 |
| 轮询在观战者多时放大 CPU | 响应变慢 | 观战响应不触发 LLM、不做深拷贝（投影按需裁剪字段）；压测 50 观战者 |
| 前端拆分引入回归 | 对局页坏掉 | 对局页行为零变化作为验收项；先接 state.js 再改渲染 |

**回滚**：整个特性在单一分支，`/api/live` 与 `/spectate` 均为向后兼容的增量变更；回滚即重新部署 v1.3.1，旧前端不依赖新字段。

## 验收映射

| 验收项 | 对应 FR | 验证方式 |
|---|---|---|
| 大厅字段完整、可排序筛选 | FR-001~004 | `tests/lobby.test.js` + 手工走查 |
| 空态与不可观战过滤 | FR-005~006 | 单测（空列表、混入 over 局） |
| 观战快照全量身份、无夜间行动明文 | FR-007~008 | `api-selftest` 隐私断言 |
| 观战写 403 | FR-009 | `api-selftest` |
| 增量事件 2s 内、终局推送 | FR-010~011 | 手工 + 事件 `seq` 单调断言 |
| 过期房间引导 | FR-012 | 单测 404 → 前端态 |
| 票型与事件一致 | FR-013 | 引擎冒烟：`sum(tally) === 投票人数` |
| 阵营统计、时间轴 | FR-014~015 | 冒烟断言 + 结算页走查 |
| 大厅 P95 < 300ms（100 局） | FR-016 | 压测脚本（本地造 100 房间） |
| 观战不增 LLM 调用 | FR-017 | 冒烟对比 `llm.callCount`（0 观战 vs 5 观战） |
