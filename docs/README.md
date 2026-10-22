# 文档目录

只放**还有决策价值**的文档。一次性的评审记录、已被取代的旧版对齐清单、迭代任务分解，交付完就删——
历史在 git 里，不需要第二份。

| 文档 | 管什么 | 什么时候看 |
|---|---|---|
| [PRD.md](./PRD.md) | 产品定位、需求（R1~R7）、非功能要求、版本路线图、工程决策与风险、开放问题 | 排期、定范围、判断「这个功能要不要做」 |
| [standard/](./standard/README.md) | 规范入口：[DESIGN-V2.md](./standard/DESIGN-V2.md) 视觉、[SECURITY.md](./standard/SECURITY.md) 安全 | 写界面前、加接口前 |
| [AI-PERSONA.md](./AI-PERSONA.md) | AI 的信息边界、人格参数（牌感/风格/话量/攻击性/易受影响）、推理深度分层 | 改 prompt、加角色、调 AI 表现 |
| [screenshots/](./screenshots/) | 六屏 + 夜幕的当前实况截图（`npm run screens` 生成） | 写 README、做设计走查 |

## 约定

- **单一事实来源**：同一个结论只写一处，其它文档引用而不是复述。视觉只认 `standard/DESIGN-V2.md`，安全只认 `standard/SECURITY.md`。
- **只留最新版**：设计稿以 Ardot 文件与 `DESIGN-V2.md` 为准，仓库里不再存历史原型 HTML；旧版对齐清单一律删除。
- **过程性文档不留档**：迭代任务分解、一次性评审、逐版本回归记录，完成后结论并入 PRD 对应章节即可。
- **截图是证据，不是判据**：改完 UI 跑 `npm run screens`，截图存 `docs/screenshots/`，但规格以文档为准。

## 需求规格（specs/）

按迭代记录**需求本身**（用户故事、验收标准），任务分解与执行清单不保留：[specs/README.md](../specs/README.md)。
