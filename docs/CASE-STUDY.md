# 设计案例与取舍

## 参考项目

### Obsidian

Obsidian 的 Canvas 把笔记、网页、图片和关系放在同一块无限白板中，同时底层仍然是本地 Markdown 文件。

对 LifeOS 的启发：

- 资料和视图分离。
- 图关系适合探索，不应该取代正文。
- 视觉层可以替换，但文件名和 frontmatter 应保持稳定。

参考：<https://obsidian.md/canvas>

### AFFiNE

AFFiNE 把文档和“无边界画布”放在同一个工作空间里，强调本地优先和开源编辑器。

对 LifeOS 的启发：

- 同一份内容可以在文档和空间视图之间切换。
- 自由布局适合规划，固定仪表盘适合每日使用，两者不能互相替代。

参考：<https://affine.pro/pricing>

### Khoj

Khoj 支持读取本地 Markdown、PDF、Word 和 Obsidian 资料，并能使用本地模型或在线模型对话、创建 Agent。

对 LifeOS 的启发：

- 对话层应该通过模型适配器接入，而不是写死在 3D 前端。
- 文档检索、长期记忆和对话策略应分层实现。

参考：<https://github.com/khoj-ai/khoj>

### Local-first software

Ink & Switch 的 local-first 原则强调：本地数据可直接使用、离线可用、跨设备协作，并且用户保留数据控制权。

对 LifeOS 的启发：

- Markdown 作为主数据。
- 搜索索引和数据库可以重建。
- 云端同步是能力，不是资料存在的唯一前提。

参考：<https://www.inkandswitch.com/local-first/>

## 本项目采用的组合

```text
Obsidian 的 Markdown 可迁移性
+ AFFiNE 的空间化表达
+ Khoj 的本地文档对话思路
+ Dify 的 Agent 工作流扩展性
+ Three.js 的三维视觉
```

没有直接套用某一个项目，而是先保证：

1. 资料不会锁进数据库。
2. 三维界面可以独立运行。
3. 对话模型可以替换。
4. 每个回答尽量带本地来源。
