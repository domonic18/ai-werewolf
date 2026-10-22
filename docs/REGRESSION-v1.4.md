# v1.4 回归记录（001 游戏大厅与对局观战）

> 版本：v1.4.1 ｜ 日期：2026-10-22 ｜ 执行：domonic + AI Agent

## 0. 结论

v1.4（R3.2 大厅 + R6.3~6.6 交互）全部交付并上线；四层验证全绿：单测 87 项、线上回归 20 项、浏览器实跑 3 条链路、移动端 4 视口走查。

| 层 | 命令 | 结果 |
|---|---|---|
| 单元 + 集成 | `npm test` | **87 passed / 10 files** |
| 类型 | `npm run typecheck` | 前后端均无错误 |
| 构建 | `npm run build` | 前端 179KB / gzip 59.7KB |
| 线上回归 | `npm run smoke:live` | **20/20 passed** |
| 浏览器实跑 | Playwright（Chrome for Testing） | 首页 / 大厅 / 开局 / 投票 / 结算 / 观战 均正常 |
| 移动端 | 375 / 390 / 320 / 横屏 844 | 无横向溢出、无控制台错误 |

## 1. 测试覆盖

| 文件 | 用例 | 关注点 |
|---|---|---|
| `tests/json.test.ts` | 13 | JSON 提取（前后缀、嵌套、转义）、玩家名匹配 |
| `tests/lobby.test.ts` | 18 | 大厅投影、筛选（含「我的对局」）、排序、游标翻页、100 局 P95 |
| `tests/engine-smoke.test.ts` | 6 | 10 局冒烟、事件序号、夜晚零泄露、复盘时间轴、用药与死因一致性 |
| `tests/server-hardening.test.ts` | 16 | 观战投影隔离、房间容量、静态 404、玩家凭证、staging 只读 |
| `tests/api-selftest.test.ts` | 4 | 进程内全链路（开局 → 应答 → 事件流 → 观战） |
| `tests/llm-runtime.test.ts` | 4 | AI 通道不可用时的降级（站点必须活着） |
| `tests/tally.test.ts` | 9 | 票型派生（复位、settled、排序、比例） |
| `tests/timeline.test.ts` | 7 | 双视角时间轴文案（被救不谎报死亡、死因、放逐票数） |
| `tests/format.test.ts` | 4 | 阶段徽章口径（含投票、准备中） |
| `tests/url.test.ts` | 6 | 分享码拼接（POST 必须带，否则网关 403） |

## 2. 隐私红线专项

| 断言 | 位置 |
|---|---|
| 玩家快照座位不含 `role` / `camp` / `factions` / `timeline` | `server-hardening` + `live-smoke` |
| 玩家复盘不含死因与用药（无 `saved` / `cause`） | `engine-smoke` + `live-smoke` |
| `game-start` 事件只带 `gameId`，不内嵌真人快照 | `api-selftest` + `live-smoke` |
| 夜晚事件流（`night-cue` / `log:night`）不含任何玩家名 | `engine-smoke` |
| 观战投影含 `pendingAction` 即视为失败 | `server-hardening` |
| 观战者 `POST /action`、`POST /quit` 一律 401 | `server-hardening` + `live-smoke` |

## 3. 浏览器实跑清单（390×844）

1. **首页**：Hero、恢复横幅（无存档时不显示）、开局卡、精选 2 局 + 「全部 N 局 ›」、战绩墙、版本号 v1.4.1
2. **大厅**：统计卡（进行中/观战中/决赛圈）、筛选 chips ×4、排序 ×2、卡片/紧凑行切换、加载更多、空态与重试
3. **对局**：开局成功（`playerToken` 落本地）、座位 6 个、发言顺序条、金色发言面板、快捷话术、实时票型 + 座位得票角标、发言/事件双 tab
4. **结算**：胜负、身份揭晓、回合时间轴、AI 内心戏、本局记录、再来一局
5. **观战**：阵营存活条、全量身份座位卡、实时票型、上帝视角时间轴、离开观战
6. **失效态**：凭证失效（401）与对局被清理（404）分别给出不同文案

## 4. 走查中发现并修掉的真实 bug（上线前拦下）

| 现象 | 根因 | 修法 |
|---|---|---|
| 刷新后点「回到对局」进入空白对局页 | P0-a 加了玩家凭证后，首页恢复横幅仍调 `open(id)`，没带 token，轮询直接 401 | `resumeGame()` 从本地存档读 token 再 `open`；大厅「继续」同源处理 |
| 观战局结束永远停在观战页 | `finished` 只看玩家快照，观战者快照始终为 null | 按当前视角取（`watching ? spectate : snapshot`） |
| 大厅阶段标签被拉成竖条 | 类名 `tag stage` 撞上对局舞台 `.stage{min-height:132px}` | 改名 `tag phase` |
| 开局提示 `Failed to fetch` | 平台网关要求请求带 sharecode，前端 POST 没带 | 统一在 `api/client.ts` 补 sharecode + 非 JSON 响应给可读错误 |

## 5. 断言失败过的三次（值得记下来）

1. `live-smoke` 首轮用不存在的 `gameId` 验 401，实际拿到 404——路由先判房间存在，这是对的；改成先开局再用真实 id。
2. 「AI 发言非话术」取了最后一条 `speech`，取到真人自己输入的那句短话——必须按 `isHuman === false` 过滤，并等到白天发言出现（夜间答完还要等一轮）。
3. 时间轴「下毒者死因」断言过严：同一个人既被刀又被毒时只记一条、死因记为「刀」，测试已按此修正。

## 6. 明确不解决的边界

- 对局凭证存 `localStorage`，换设备无法恢复 —— 需要登录态（v1.5 / R3.1）
- 观战不延迟（Q3 未拍板），代码未启用 `visibleAt`
- 房间为进程内存态，服务重启后全部对局失效；多副本部署前必须先让房间状态可共享
