# AI 狼人杀 · Agent 补位局

WorkBuddy「1024 造物挑战」参赛作品。6 人局狼人杀：1 名真人玩家 + 5 个 AI Agent 补位。

**AI 的全部言行（发言、投票、刀人、验人、用药）由云服务大模型实时生成**——游戏逻辑运行在 Node 服务端，前端只是轮询驱动的薄客户端；没有任何写死的台词或规则话术，LLM 调用失败即中止对局并亮明原因。

- 线上地址: https://werewolf-ai-01048.app.workbuddy.host/?sharecode=2IBHTRFFFL
- 技术形态: Node.js（原生 http，零框架）+ WorkBuddy Cloud Service（LLM API + 云数据库）

## 架构

```
浏览器（public/）                Node 服务端（src/）                云服务
┌──────────────┐   轮询事件流   ┌──────────────────┐   SDK 调用   ┌─────────┐
│ app.js 薄客户端 │ ───────────→ │ HTTP API + 房间管理 │ ──────────→ │ LLM API │
│ 渲染 + 提交动作 │ ←─────────── │ 游戏引擎（权威状态） │             └─────────┘
└──────────────┘   事件/快照     │ AI 决策（prompt 组装）│   PostgREST  ┌─────────┐
                                └──────────────────┘ ──────────→ │ 云数据库 │
                                                                  └─────────┘
```

- **权威状态在服务端**：客户端无法作弊，身份/夜晚行动对前端不可见
- **事件溯源**：对局以事件流（seq 递增）记录，客户端增量拉取，天然支持观战
- **真人输入挂起**：引擎在需要真人决策处 `waitHuman` 挂起，HTTP `action` 接口唤醒

## 目录结构

```
werewolf-ai/
├── public/                 # 静态前端（无构建，直接可服务）
│   ├── index.html
│   └── assets/
│       ├── app.js          # 薄客户端：轮询事件流 + 渲染 + 提交动作
│       └── style.css
├── src/
│   ├── server/
│   │   ├── index.js        # HTTP 服务器：静态文件 + API，单端口 0.0.0.0:$PORT
│   │   ├── routes.js       # REST API 路由
│   │   └── rooms.js        # 房间管理：对局生命周期与清理
│   ├── game/
│   │   ├── engine.js       # 对局引擎：夜/昼流程、投票、胜负、事件流
│   │   └── roles.js        # 角色定义、牌组、AI 人设、胜负判定
│   ├── ai/
│   │   ├── llm-gateway.js  # LLM 网关：模型选择、流式收集、自检
│   │   ├── ai-player.js    # AI 决策：prompt 组装（公开+私有信息）
│   │   └── json.js         # JSON 提取（括号深度法）与名字匹配
│   └── cloud/
│       └── match-store.js  # 战绩存取（ww_matches 表）
└── tests/
    ├── run-all.js          # 测试入口（npm test）
    ├── json.test.js        # JSON 提取/名字匹配 单元测试
    ├── engine-smoke.test.js# 引擎冒烟：Mock LLM 跑 30 局闭环
    └── api-selftest.test.js# API 全链路自测（真实 LLM 通道）
```

## 快速开始

```bash
npm install

# 服务端需要云服务凭据（publicConfig，可公开的前端安全值）
export WB_ENDPOINT="https://werewolf-ai-01048.app.workbuddy.host"
export WB_PUBLISHABLE_KEY="wbpk_xxx"

npm start          # 默认 :3000，绑定 0.0.0.0（兼容 sites 沙箱）
npm test           # 单元测试 + 引擎冒烟 + API 自测（含真实 LLM 通道）
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 服务与 LLM 通道自检 |
| GET | /api/models | 可用模型列表 / POST /api/models/select 切换 |
| POST | /api/games | 开局 `{playerName}` → `{gameId}` |
| GET | /api/games/:id | 对局快照（真人视角含私有信息） |
| GET | /api/games/:id/events?since=N | 增量事件流（轮询，1.2s） |
| POST | /api/games/:id/action | 提交真人选择/发言 `{value}` |
| POST | /api/games/:id/quit | 退出对局 |
| GET | /api/games/:id/spectate?since=N | 观战（只读事件流） |
| GET | /api/matches | 战绩墙 |

## 设计要点

1. **纯 LLM 驱动**：AI 每个决策点独立调用大模型（发言/投票/刀人/验人/用药），prompt 含「公开信息 + 角色私有信息 + 性格人设 + 历史内心判断」，跨回合立场连贯；失败 fail-fast，不用假话术顶替
2. **思考型模型兼容**：同时收集 `content` 与 `reasoning_content`；请求带 `response_format: json_object`；括号深度法提取 JSON（处理前后缀解释、嵌套、字符串内花括号、转义）
3. **服务端权威**：身份、夜晚行动、投票统计全部在服务端，前端只拿事件流与脱敏快照
4. **观战零成本**：事件流 + 快照分离，`/spectate` 天然只读

## 云资源

- 应用 ID: `wbapp_SURA9O6OUcSeFbq1GDG40K`（WorkBuddy Cloud Service）
- 数据表 `ww_matches`（公开读写，RLS 已开）：战绩、对局记录、AI 内心戏归档

## License

MIT
