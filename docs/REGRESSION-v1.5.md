# 回归记录 · v1.5（账号与角色体系）

**版本**：v1.5.0 ｜ **分支**：`002-login-roles` ｜ **日期**：2026-10-22
**线上**：https://werewolf-ai-01048.app.workbuddy.host/?sharecode=2IBHTRFFFL

## 一、本次交付

| 能力 | 说明 |
|---|---|
| 牌组发牌 | 6~12 人，按人数推荐牌组，真人随机占位 |
| 守卫 | 每晚守一人，不能连守；只挡狼刀不挡毒；同守同救仍死（奶穿） |
| 猎人 | 被刀/被放逐可开枪，被毒杀不能开枪；可压枪 |
| 建局配置页 | 人数分段 + 推荐牌组 + 角色加减 + 非法牌组拦截 |
| 登录 | 手机号验证码（主）/ 邮箱 Tab / 微信 / WorkBuddy；登录态首页可见 |
| 账号闭环 | 登录态在服务端生效：对局归属账号、「我的对局」跨设备、战绩按账号统计、OAuth 回调落地 |

## 二、自动化回归

| 项 | 结果 |
|---|---|
| 单元/集成测试 | **156 通过 / 17 文件**（`npm test`） |
| 类型检查 | `tsc` 前后端零错误（`npm run typecheck`） |
| 构建 | server + client 均通过（`npm run build`） |
| 线上冒烟 | **23/23 通过**（`node tools/live-smoke.mjs`） |

新增用例：
- `tests/identity.test.ts`（7）：云端认人、凭据头、缓存、401/5xx/断网降级、id 字段兼容
- `tests/match-store.test.ts`（6）：owner_id 写入、按账号过滤、个人胜负判定、staging 只读
- `tests/account-loop.test.ts`（7）：跨设备「我的对局」、越权隔离、匿名不归属、坏 token 降级、战绩 scope
- `tests/lobby.test.ts`（+3）：账号维度 vs 本机 id 的筛选优先级
- `tests/auth-actions.test.ts`（7）：SDK 调用形状（发码 `{phone}` / 邮箱 `{email}` / 验码四参数）

线上冒烟新增 3 项（`[7/7] 账号边界`）：匿名「我的对局」返回空、伪造 Bearer 降级匿名、战绩 `mine=1` 未登录回落全网。

## 三、线上验证过的关键行为

1. 匿名 `GET /api/live?filter=mine` → 0 局（不会退化成全部对局）。
2. 伪造 `Authorization: Bearer …` → 200 + 0 局，且耗时 ≈0.45s（确实打了一次云端并被拒，不是本地假装）。
3. `GET /api/matches?mine=1` 未登录 → `scope=all`，战绩墙照旧。
4. 站点静态资源、开局、推进、观战、退出全链路 20 项全通过。

## 四、数据库变更

```sql
ALTER TABLE ww_matches ADD COLUMN IF NOT EXISTS owner_id text;
CREATE INDEX IF NOT EXISTS ww_matches_owner_id_idx ON ww_matches (owner_id, created_at DESC);
```

历史数据 `owner_id` 为空（视为匿名局），不影响战绩墙展示。

## 五、待人工验证（T027）

- 微信登录：需 Provider 在云服务管理页开启，且 `redirectTo` 为本站点根路径（已发布 HTTPS）。
- WorkBuddy 登录：PKCE 依赖同标签页 sessionStorage，必须在同一标签页完成跳转。
- 回归路径：点按钮 → 授权页 → 回跳带 `code/state/provider` → 首页出现「已登录」账号卡 → URL 上的 code 被清掉而 `sharecode` 保留。
- 失败时页面顶部会显示「第三方登录失败：…」，不会静默。

## 六、已知限制

- 房间与观战心跳是单进程内存态，重启即清空；战绩落云表不受影响。
- 服务端认人每次请求最多一次云端往返（3s 超时 + 60s 缓存）；云端不可达时全部按匿名处理，不阻断开局。
- 战绩墙目前只展示全网；账号维度仅在结算页「我的累计战绩」与 `?mine=1` 接口。
