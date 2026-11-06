# LifeOS 架构

## 设计原则

1. 资料优先：Markdown 是源数据，界面、数据库和模型都可以替换。
2. 本地优先：默认只监听 `127.0.0.1`，不向外部服务发送资料。
3. 分层解耦：三维视图不直接依赖 Dify、Ollama 或某个云模型。
4. 可评测：后续所有检索与 Agent 改动都需要固定问题集比较效果。
5. 敏感数据最小暴露：云端模型只能看到用户明确授权的上下文。

## 当前结构

```text
React + Three.js 视觉层
        ↓
本地 Express API
        ↓
Markdown 资料文件
        ↓
Ollama 对话模型
```

### 视觉层

- React 管理界面状态。
- React Three Fiber 和 Three.js 渲染三维宇宙。
- 领域节点、连线、核心球体、粒子星空和选中状态来自本地数据。

### API 层

- `GET /api/dashboard`：首页指标、领域和近期轨迹。
- `GET /api/notes`：读取 Markdown 资料。
- `POST /api/notes`：把新记录写入对应领域目录。
- `GET /api/status`：检查 Ollama 和模型状态。
- `POST /api/chat`：组合最近资料、对话历史和用户问题，调用 Ollama 并流式返回。

### 资料层

Markdown frontmatter：

```yaml
---
title: 记录标题
date: 2026-11-04
domain: learning
tags:
  - dify
  - rag
---
```

领域 ID：

- `learning`
- `work`
- `body`
- `mind`
- `life`
- `future`

## 下一阶段扩展

### 模型适配器

在 API 内增加统一接口：

```text
generate({ messages, tools, context, model, signal })
```

实现可以分别连接到 Ollama、Dify、OpenAI-compatible API 或其他云模型。前端不感知具体供应商。

### RAG

建议顺序：

1. Markdown 增量索引。
2. 使用 `bge-m3` 生成向量。
3. 按领域、日期和标签做元数据过滤。
4. 混合检索。
5. 增加 rerank。
6. 返回精确来源和原文片段。

### Skill

每个 Skill 是一个独立目录，包含：

```text
skill-name/
├── SKILL.md
├── input.schema.json
├── output.schema.json
└── tests/
```

Skill 必须声明：

- 能读取哪些领域
- 能调用哪些工具
- 是否需要写入
- 是否允许发送到云端
- 输出结构和引用规则

### 云端

建议先支持“混合模式”：

- 本地资料索引始终在本机。
- 敏感领域只使用本地模型。
- 普通复杂任务可选择云端模型。
- 上传前显示将发送的上下文摘要。

## 参考资料

- Local-first software: <https://www.inkandswitch.com/local-first/>
- React Three Fiber: <https://r3f.docs.pmnd.rs/>
- Three.js: <https://threejs.org/docs/>
- Ollama API: <https://github.com/ollama/ollama/blob/main/docs/api.md>
- Dify Docs: <https://docs.dify.ai/>
