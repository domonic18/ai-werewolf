---

description: "Task list for 001 游戏大厅与对局观战"
---

# Tasks: 游戏大厅与对局观战

**Input**: `/specs/001-lobby-spectate/`（spec.md / plan.md）

**Tests**: 按宪法第 IV 条强制包含——每个用户故事都必须有不变量断言，测试任务不可省。

**Organization**: 按用户故事分组，US1/US2 为 P1（MVP），US3/US4 为 P2。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可并行（不同文件、无依赖）
- 粒度：单任务 ≤ 2 人日；括号内为预估

## Phase 1: Setup（共享基建）

- [x] T001 新增 `src/server/lobby.js` 骨架，导出 `toEntry(room)` / `list(rooms, query)` / `encodeCursor()` / `decodeCursor()`（0.5d）
- [x] T002 [P] ~~新增 `public/assets/state.js`~~ 已由 React 迁移替代：zustand 单 store（`client/src/store/gameStore.ts`），不再自建 store（0.5d）
- [x] T003 [P] ~~自建 run-all~~ 已由 vitest 接管：`tests/*.test.ts` 自动发现（0.1d）

**验收**：`npm test` 仍全绿（新增空测试文件跑通）。

---

## Phase 2: Foundational（阻塞项，必须先完成）

- [x] T004 `src/game/engine.ts` 新增 `timeline: NightRecord[]`：夜晚结算写入狼刀/解药/毒药/死因，投票后补 `exiled`/`tie`（1d）
- [x] T005 票型从 `vote` 事件派生（实现为 `client/src/lib/tally.ts` 纯函数，引擎不新增状态——事件流即唯一事实来源）（0.5d）
- [x] T006 [P] 阵营聚合由 `engine.spectateSnapshot()` 内的 `tally()` 实现（狼/好人存活与总数）（0.5d）
- [x] T007 `src/server/rooms.js` 增加 `spectators: Map<clientId, lastSeenAt>`、`touch(clientId)`、`pruneSpectators(30s)`、`spectatorCount`（0.5d）

**验收**：`tests/engine-smoke.test.js` 增加断言——每局结束后 `timeline.length === round`、`sum(tally) === 投票人数`；10 局全绿。

---

## Phase 3: US1（P1）大厅发现与进入

**目标**：`/api/live` 支持字段补全 + 筛选 + 游标分页；前端大厅可浏览并能开局。

- [x] T008 [US1] `src/server/lobby.js` 实现 `toEntry()`：`phaseLabel`（第 N 天·投票 / 第 N 夜）、`alive`、`spectators`、`hasHuman`、`isFinal`、`spectatable`（0.5d）
- [x] T009 [US1] `src/server/lobby.js` 实现筛选（all/human/final）+ 排序（spectators/created）+ 稳定游标（`sortValue,startedAt,gameId`）（1d）
- [x] T010 [US1] `src/server/routes.js` 改造 `/api/live`：解析 `filter/sort/limit/after`，返回 `games/nextCursor/total`，保留旧字段（0.5d）
- [x] T011 [P] [US1] `tests/lobby.test.ts`：空列表、混入 over 局被过滤、同观战人数 30 局游标翻页无重无漏、筛选命中（0.5d）
- [x] T012 [US1] 前端大厅列表：列表项渲染（房主/人数/阶段徽章/存活条/👁 观战数）、空态、「开一局」入口（1d）
- [x] T013 [US1] 前端筛选 chips + 排序切换 + 上滑加载「还有 N 局」（1d）

**独立验收**：造 3 局 → 大厅正确列出 → 点「观战」3 秒内进入；造 0 局 → 空态；造 30 局 → 上滑加载完 30 条无重复。

---

## Phase 4: US2（P1）观战上帝视角与公平性

**目标**：观战拿到全量身份投影；玩家拿不到他人身份；观战写操作被拒。

- [x] T014 [US2] `src/game/engine.js` 新增 `spectateSnapshot()`：全量 `role/camp`、`factions`、`tally`、`timeline`、`visibleAt`，**不含** `pendingAction` 内部结构与"谁正在行动"（1d）
- [x] T015 [US2] `src/server/routes.js` `/spectate`：登记 `client`、返回 `snapshot`+`spectators`、保留旧 `events`（0.5d）
- [x] T016 [US2] 写操作守卫：`/action`、`/quit` 校验 `X-Player-Token`，无凭证 401（实现为 P0-a 一次性凭证，比 403 更严格）（0.5d）
- [x] T017 [P] [US2] `tests/server-hardening.test.ts` 新增隐私断言：观战快照能读到他人 `role`；玩家快照 `players[].role` 不存在；夜晚事件流无「玩家名+行为词」共现（1d）
- [x] T018 [P] [US2] `tests/server-hardening.test.ts` 新增观战写断言：观战者 `POST /action` → 403，且 `version` 不变（0.3d）
- [x] T019 [US2] 观战视图前端：身份座位卡、阵营存活进度条（`FactionBar`）、实时票型；「延迟/实时」标注随 Q3 待定（1.5d）
- [x] T020 [US2] 观战终局与失效：结算页按当前视角判定结束（修掉观战永远进不去结算页的 bug）、观战走上帝视角时间轴、「离开观战」入口（0.5d）

**独立验收**：同一局分别用玩家与观战身份请求，字段对照表通过；观战页 390px 无横向滚动；中途结束/中止均有明确终态。

---

## Phase 5: US3（P2）规模化浏览

- [x] T021 [US3] 密度自适应：≥6 局切紧凑列表，<6 局用卡片（0.5d）
- [x] T022 [US3] 「我的对局」筛选：服务端 `filter=mine&mine=<gameId>`（服务端不认识「我」，由前端带上本地存档 id），点自己那局改为「继续」并带凭证（0.5d）
- [x] T023 [P] [US3] `tests/lobby.test.ts` 增加 100 局压测：`list()` P95 < 50ms + 游标翻完 100 局不重不漏（0.3d）

**独立验收**：30 局场景下首屏 10 条、筛选切换后计数正确、上滑到底显示「没有更多了」。

---

## Phase 6: US4（P2）局势可读

- [x] T024 [US4] 对局页接入 `tally`：投票阶段实时条形 + 座位得票角标（只在事件到达时增长）（1d）
- [x] T025 [US4] 结算页时间轴：玩家看公开信息、观战看死因/用药/票数（`RoundTimeline` + `lib/timeline.ts`）（1d）
- [x] T026 [P] [US4] `tests/engine-smoke.test.ts` 断言：`saved` / `poisonTarget` / 死因与实际用药一致（可配桩覆盖救人 + 下毒两种场景）；守卫未实装，`guarded` 随 v1.5 补（0.5d）
- [x] T027 [US4] 移动端走查：375 / 390 / 320 / 横屏 844 四视口，无横向溢出、无控制台错误（0.5d）

**独立验收**：第 3 天投票阶段票型与事件严格一致；结算页时间轴与 `timeline` 完全对应。

---

## Phase 7: Polish（收尾）

- [x] T028 [P] 版本号 v1.4.1：`package.json` 单一来源，构建期注入页脚；静态资源自带 hash（0.2d）
- [x] T029 [P] 更新 `docs/PRD.md`：R3.2 标已实现，R6.3~6.6 打勾，路线图 v1.4 标已完成（0.2d）
- [x] T030 [P] 更新 `AGENTS.md`：目录结构（client/src 分层、tools、docs）与各目录 Agent 上下文（0.1d）
- [x] T031 全量回归：`docs/REGRESSION-v1.4.md`（87 单测 + 20 项线上 + 浏览器实跑 + 4 视口走查）留档（0.5d）
- [x] T032 部署验证：`tools/live-smoke.mjs` 自动核对首页/产物/404/凭证/真实发言/观战投影共 19 项（0.3d）

---

## 依赖关系

```
T001~T003 → T004~T007 → T008~T013(US1) ─┐
                          T014~T020(US2) ─┼→ T021~T023(US3) → T024~T027(US4) → T028~T032
```

- US1 与 US2 可在 T007 之后并行（不同文件为主，仅 `routes.js` 有接触，注意按端点分段提交）
- US3 依赖 US1 的列表契约；US4 依赖 T005（tally）与 T004（timeline）

## 预估

| 阶段 | 人日 |
|---|---|
| Setup + Foundational | 3.1 |
| US1 | 4.5 |
| US2 | 5.3 |
| US3 | 1.3 |
| US4 | 3.0 |
| Polish | 1.8 |
| **合计** | **约 19 人日**（单人约 4 周；若仅冲参赛，可只做 P1 = 12.9 人日） |

## 待确认（阻塞项）

- **Q3 观战延迟**：未定则按"不延迟 + 预留 `visibleAt`"实现；若定为 30s 延迟，T014/T015/T019 各 +0.5d
