# WorkBuddy 应用发布：支持的技术栈与原始资料

> 目的：给团队一个可核对的清单——「能写什么」和「能发布什么」是两件事。
> 整理时间：2026-10-22。所有结论都附来源，未标注来源的一律视为未证实。

## 一、官方在线文档（可点击）

| 文档 | 地址 | 它回答了什么问题 | 是否覆盖发布侧技术栈 |
|---|---|---|---|
| 产品概述（CodeBuddy / WorkBuddy IDE） | https://www.workbuddy.ai/docs/zh/ide | 产品能力、语言与框架支持、部署阶段说明 | 部分（只写"支持什么语言写代码"） |
| 网站应用开发与发布 | https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/App-Publishing/Web-App | 生成应用、开启云服务、发布/更新/下线、管理入口 | **没有**（全文未提技术栈） |
| 轻量发布（本地 HTML → 在线链接） | https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Lightweight-Publish | 纯静态发布、`workbuddy.link` 域名、HTML + CSV | 只覆盖静态 |

产品概述原文（`https://www.workbuddy.ai/docs/zh/ide` → 「广泛的语言和框架支持」）：

> 理论上不限制代码语言，支持主流开发技术栈。
> - 前端：HTML、JavaScript、CSS、Vue、React、Bootstrap 等
> - 后端：Node.js、Python、Java、C#、Ruby、PHP 等
> - 客户端：Java、Kotlin、Swift、Objective-C、C# 等
> - 其他：C++、Go、Rust、TypeScript、Shell、PowerShell、R、MATLAB 等

同一页「部署阶段：从代码到上线」：

> - 快速部署：一键部署到沙箱环境
> - 分享与协作：生成可公开访问的链接，供团队验证和反馈

**注意**：这一段说的是「AI 能帮你写这些语言的代码」，`Java / C# / PHP` 都在列，但发布沙箱**跑不了** Java 项目（见下一节）。不能把这份清单当成发布能力清单。

## 二、发布沙箱的真实约束（客户端内置文档，最权威）

在线文档没有写这些，但客户端的 sites 技能文档写得很明确。
文件：`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/plugins/workbuddy-builtin/skills/sites/SKILL.md`

### 支持范围（第 225-238 行）

> The publishing sandbox natively supports **Node.js / Python / Go / static sites** as a single public HTTP port. It does **NOT** support:
> - **Java / Maven / Gradle** projects (no JVM/Maven/Gradle build in the sandbox).
> - Projects that need **external services** the sandbox does not provide — MySQL, PostgreSQL, Redis, MongoDB, Kafka, RabbitMQ. Only a single HTTP port is exposed; there is no database, cache or message queue alongside it.
>   … **SQLite is fully supported** … and a connection string pointing at a public managed database (e.g. Supabase) is allowed too, because the sandbox can reach the internet.

### 项目必须满足的条件（第 293-301 行）

> - The service MUST listen on the `PORT` environment variable and bind `0.0.0.0`.
> - Pure static / PDF: … the tool serves it with an internal HTTP server (or `python3 -m http.server "$PORT" --bind 0.0.0.0`).
> - Vite-based frameworks (Vite / Vue / React / Svelte): the dev/preview server MUST allow the reverse-proxy host — set `server.host = "0.0.0.0"` and add the deploy domain to `server.allowedHosts` (or `allowedHosts: true`, or `--host 0.0.0.0`), otherwise Vite rejects the request with "Blocked request. This host is not allowed."

### 部署参数（第 303-320 行）

> - `language` — `node` / `python` / `go` / `static` / `auto`
> - `port` — 单个公开端口（注入为 `PORT`），默认 3000
> - `installCmd` / `startCmd` — 覆盖自动探测的安装/启动命令，`startCmd` 必须监听 `$PORT`
> - `entryHtml` — 静态站点入口页
> - `appName` — 应用列表里的展示名（≤12 字）

## 三、结论

| 问题 | 结论 | 依据 |
|---|---|---|
| React + TypeScript 能发布吗 | **能** | 官方文档「前端 React / TypeScript」+ 内置文档专列 Vite/Vue/React/Svelte 的配置要求 |
| Vite 项目怎么发布 | 两条路：① `vite build` 产出静态文件，由 Node/Python 单端口服务托管（本项目选这条，避开 allowedHosts）；② 直接跑 Vite dev/preview，但必须 `host: 0.0.0.0` + `allowedHosts` | 内置文档第 298-301 行 |
| Java / Spring 能发布吗 | **不能** | 内置文档第 228 行 |
| 能用 MySQL / Redis 吗 | **不能**（沙箱只有单端口，无 DB/缓存/MQ） | 内置文档第 229-238 行 |
| 能用 SQLite / Supabase 吗 | **能**，SQLite 随项目跑；公网托管库允许（沙箱可出网） | 内置文档第 236-238 行 |
| 一个工作区能有几个已发布应用 | **一个**。不同目录只是不同 deploy target，最终落到同一 `appId`，发布即覆盖 | 本项目实测：`werewolf-ai` 与 `ww-healthcheck` 的 `deployTargetId` 不同但 `appId` 相同 |

## 四、本项目实测记录（2026-10-22）

- 16:12 部署：`language=node`、`installCmd="npm install && npm run build"`、`startCmd="npm start"`、`port=3000`
- 平台内部校验：`service verified port=3000 http=200`，随后 `deploy SUCCESS`
- 说明「`tsc` 编译后端 + `vite build` 前端 + Node 单端口托管产物」这条链路在沙箱里是可行的
- 唯一未通过的是**外网域名**：`werewolf-ai-01048.app.workbuddy.host` 在多个公共 DNS 上均为 NXDOMAIN（父域 `app.workbuddy.host` 亦无记录），与代码/技术栈无关

## 五、容易踩的坑

1. 把「支持的语言列表」当成「发布支持列表」——Java/C#/PHP 能写不能发。
2. 用 Next.js 的 SSR/文件路由，或依赖 `vite preview` 直接对外，会撞上反向代理 host 校验。
3. 以为可以起多个端口（前端 3000 + 后端 8000），实际只有一个公开端口，必须自己反代或合并成一个进程。
4. 以为发布是"新建"，实际是覆盖同一 appId 的内容；想双环境只能换工作区或换承载。
