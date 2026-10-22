# Tasks: 登录与角色体系（002）

**Input**: `specs/002-login-roles/`（spec.md / plan.md）
**Tests**: 按宪法第 IV 条强制包含。

## Phase 1: 牌组与发牌（无登录依赖，先让 8/9 人局可玩）

- [x] T001 `src/game/engine.ts` `setup()` 支持传入牌组：`deck?: DeckSlot[]`，默认 `recommendDeck(6)`；按牌组展开后 shuffle，真人随机占位（1d）
- [x] T002 `POST /api/games` 接受 `players` / `deck`，用 `validateDeck()` 校验，非法返回 400 与具体原因（0.5d）
- [x] T003 [P] `tests/engine-smoke.test.ts` 覆盖 8 人与 9 人局：人数、狼人数、神职数正确，能打到结束（0.5d）
- [x] T004 [P] `tests/catalog.test.ts` 补充：8 人牌组发牌后狼人恰 2 名、神职 2 名（0.3d）

**验收**：`POST /api/games {players:8}` 能开局并完整跑完；非法牌组 400。

## Phase 2: 守卫（US3）

- [x] T005 `src/game/types.ts` 增加 `guarded?: boolean` / 引擎维护 `lastGuarded`（0.3d）
- [x] T006 `src/game/behaviors.ts` 新增 `guardBehavior`：口令「守卫请睁眼，选择今晚守护的人…」；不能连守同一人（1d）
- [x] T007 `NightHost` 扩展 `getLastGuarded()` / `setGuarded()`；夜晚结算时守卫目标免于狼刀（0.5d）
- [x] T008 [P] 单测：守中不亡、连守无效、守自己不违规、守卫不防毒（1d）
- [x] T009 复盘时间轴增加 `guarded` 记录，观战可见、玩家不可见（0.5d）

## Phase 3: 猎人（US3）

- [x] T010 `src/game/behaviors.ts` 新增 `DeathHook` 类型与 `hunterBehavior.onDeath`：非毒杀可开枪（1d）
- [x] T011 引擎在「死讯公布后、判胜负前」调用死亡钩子；开枪结果写入事件与时间轴（0.5d）
- [x] T012 [P] 单测：被刀可开枪、被放逐可开枪、被毒不能开枪、猎人开枪带走最后一狼判好人胜（1d）
- [ ] T013 前端：猎人开枪的选项面板复用 `pendingAction`，文案与选项由服务端给（0.5d）

## Phase 4: 建局配置页（US2）

- [ ] T014 前端 `client/src/pages/SetupPage.tsx`：人数 6/8/9/10/12 分段 + 推荐牌组 + 角色加减 + 校验提示（1.5d）
- [ ] T015 `client/src/api/client.ts` 增加 `roles(players)` 与 `createGame({players, deck, playerName})`（0.3d）
- [ ] T016 首页「开始一局」改为进配置页；旧路径保留为「快速开始（6 人）」（0.5d）

## Phase 5: 登录（US1）

- [ ] T017 `src/server/auth.ts`：`getOwner(req)` 解析 Bearer token → userId（不通过则 null）（0.5d）
- [ ] T018 `POST /api/games` 写入 `Room.ownerId`；`ww_matches` 增 `owner_id` 列并写入（1d）
- [ ] T019 前端 `client/src/auth/useSession.ts`：登录态、静默刷新、降级为未登录（1d）
- [ ] T020 前端 `LoginPage`：手机号 OTP 主推 + 微信/WorkBuddy 按钮（Provider 未开则隐藏）+ 60s 重发（1.5d）
- [ ] T021 「我的对局」改为账号维度：登录后查 `GET /api/live?filter=mine&owner=me`，未登录回落本机存档 id（1d）
- [ ] T022 [P] 单测：无 token 不影响开局、有 token 归属正确、会话过期降级（0.5d）

## Phase 6: 战绩归属（US4）

- [ ] T023 `GET /api/matches?mine=1` 按 owner 过滤；结算页显示累计战绩（1d）
- [ ] T024 [P] 单测：mine=1 只返回自己的、未登录回落全量（0.5d）

## Phase 7: 收尾

- [ ] T025 版本 v1.5.0、PRD/AGENTS 同步、`docs/REGRESSION-v1.5.md`（0.5d）
- [ ] T026 线上回归补断言：8 人局可开、守卫/猎人事件出现、登录态不影响未登录路径（0.5d）
- [ ] T027 OAuth（微信/WorkBuddy）上线后验证清单（0.5d）

## 依赖

```
T001~T004（牌组）→ T005~T009（守卫）→ T010~T013（猎人）→ T014~T016（配置页）
                                    ↘ T017~T022（登录）→ T023~T024（战绩）→ T025~T027
```

## 预估

| 阶段 | 人日 |
|---|---|
| 牌组与发牌 | 2.3 |
| 守卫 | 3.3 |
| 猎人 | 3.0 |
| 建局配置页 | 2.3 |
| 登录 | 4.5 |
| 战绩归属 | 1.5 |
| 收尾 | 1.5 |
| **合计** | **约 18.4 人日**（只做 P0 = 8.6 人日，8/9 人局即可上线） |

## 待确认（阻塞）

- **Q6 同守同救**：默认「仍死」，影响 T007/T008 的断言
- **Q7 猎人开枪时机**：默认当场，影响 T011
- **Q8 是否允许永久匿名**：默认允许，影响 T021 的兜底逻辑
