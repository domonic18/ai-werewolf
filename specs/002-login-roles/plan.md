# 实施计划：登录与角色体系（002）

**Spec**: `specs/002-login-roles/spec.md`
**分支**: `002-login-roles`
**目标版本**: v1.5.0

## 1. 技术路径

### 1.1 登录（US1）

| 层 | 方案 |
|---|---|
| SDK | `@tencent-ai/workbuddy-cloud-sdk` 的 Auth 模块（手机号 OTP 主推，微信 / WorkBuddy OAuth 并列） |
| 服务端 | 新增 `src/server/auth.ts`：从 `Authorization: Bearer <access_token>` 解析出 `userId`；**只做身份识别，不做授权判定**（游戏接口仍是服务端权威） |
| 前端 | `client/src/auth/`：`useSession()`（登录态 + 静默刷新）、`LoginPage`；token 存 `sessionStorage`（比 localStorage 更克制，关浏览器即失效） |
| 归属 | `POST /api/games` 带上登录态时，把 `ownerId` 写进 `Room`；`ww_matches` 增 `owner_id` |

**关键决策**：登录是**可选增强**，不是前置条件。理由有三：① 参赛 demo 不希望被登录墙挡住；② 现有 100 个用例不依赖登录，避免回归面爆炸；③ 平台 OAuth 要求已发布 HTTPS 域，本地开发无法端到端验证，若强制登录会拖慢开发。

### 1.2 建局配置（US2）

- 前端新增 `SetupPage`：人数分段选择（6/8/9/10/12）+ 推荐牌组 + 角色加减
- 服务端 `POST /api/games` 接受 `players` 与 `deck`，用 `validateDeck()` 校验；不传则用 `recommendDeck(6)`
- 发牌逻辑改造：`engine.setup()` 从固定 `ROLE_DECK` 改为「按 deck 展开 + shuffle」，真人随机占位

### 1.3 新角色（US3）

按已建立的注册表扩展，**引擎主体不动**：

```
src/game/behaviors.ts
  ├─ wolfBehavior      （已有）
  ├─ seerBehavior      （已有）
  ├─ witchBehavior     （已有）
  ├─ guardBehavior     （新增：nightOrder 在狼之后、女巫之前）
  └─ hunterBehavior    （新增：不是夜间行为，走 onDeath 钩子）
```

- **守卫**：`NightHost` 需扩展 `getLastGuarded(): number | null` / `setGuarded(id)`，引擎维护 `lastGuarded` 并在每晚重置「连续」判定
- **猎人**：需要新的钩子类型 `DeathHook`（`onDeath(host, actor, cause)`），由引擎在「结算死讯后、判胜负前」调用；`cause` 区分 `wolf` / `poison` / `vote`
- 结算与复盘：`timeline` 增加 `hunterShot: { playerId, name } | null`；观战投影可见，玩家视角只看到「猎人开枪带走了 X」

### 1.4 战绩归属（US4）

- `MatchStore.save()` 增加 `ownerId`
- `GET /api/matches?mine=1` 按当前账号过滤；未登录回落全量
- 结算页显示「这是你的第 N 局 · 胜率 X%」

## 2. 宪法检查

| 原则 | 本迭代的落实 |
|---|---|
| I LLM 单一事实源 | 新角色（守卫守谁、猎人开枪打谁）同样由 LLM 决策，不写死策略 |
| II 服务端权威与信息隔离 | 守卫目标、猎人可开枪状态只在服务端；玩家快照不含他人身份；新增事件不得泄露夜间行动 |
| III 规范先行 | 本 spec 先于实现；Q6 未定则按默认值实现并在代码注释标注 |
| IV 三层可验证 | 每个新角色有单测（能力 + 边界），引擎冒烟覆盖 8/9 人局，线上回归补角色断言 |
| V 版本可追溯 | v1.5.0；`/api/health` 暴露 `roles` 版本信息（可选） |

## 3. 风险与回滚

| 风险 | 缓解 |
|---|---|
| OAuth 只能在线上验证（redirectTo 必须已发布域名） | 手机号 OTP 先行；微信/WorkBuddy 上线后灰度验证 |
| 平台 OAuth Provider 需在管理页手动开启 | 上线前 checklist 明确列出；未开启时按钮隐藏而非报错 |
| 8 人以上牌组没有实战平衡数据 | 推荐牌组写死在 `catalog.ts` 并有单测；允许手动调整 |
| 守卫/猎人引入新的夜间顺序 bug | 注册表顺序即睁眼顺序，加一条断言「口令顺序稳定」 |
| 账号维度「我的对局」涉及跨设备恢复 | 复用现有 `playerToken` 机制，不新建会话体系；恢复时同时校验 token 与 ownerId |

**回滚**：`002-login-roles` 分支独立，v1.4 线上不受影响；登录相关入口用 `FEATURE_LOGIN` 常量控制，异常可直接关闭。

## 4. 交付顺序

1. **P0** 牌组与发牌（无登录依赖，纯游戏逻辑）→ 8/9 人局可玩
2. **P0** 守卫 → 猎人（注册表扩展 + 单测）
3. **P1** 建局配置页（消费 `/api/roles`）
4. **P1** 登录（手机号 OTP → 战绩归属 → 我的对局）
5. **P2** 微信 / WorkBuddy OAuth（上线后验证）
6. **P2** 「我的战绩」筛选与结算页统计

## 5. 验收

- `npm test` 全绿（新增角色/牌组/登录态用例）
- `npm run smoke:live` 全绿（新增 8 人局与角色断言）
- 8 人局实跑一局到结算，复盘时间轴含守卫/猎人记录
- 未登录用户路径与 v1.4 无差异
