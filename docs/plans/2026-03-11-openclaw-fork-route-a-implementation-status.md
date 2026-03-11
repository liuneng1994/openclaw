# OpenClaw Fork 路线 A：实施状态（第一刀）

## 本轮目标

在不破坏现有 OpenClaw 行为的前提下，先落地“控制平面 / 执行平面分离”所需的最小公共地基，供后续逐步接入现有会话与工具体系。

## 已完成

### 1. 新增任务域模型

新增目录：`src/task/`

已落地：

- `TaskStatus`
- `TaskKind`
- `RunSessionStatus`
- `AgentProfileId`
- `TaskRecord`
- `RunSessionRecord`
- `AgentProfileRecord`
- `DEFAULT_AGENT_PROFILES`

意义：

- 先把 `Task / RunSession / AgentProfile` 从“只有设计文档”变成“仓库中可被引用的领域模型”。

### 2. 新增控制/执行协议

已落地：

- `TaskIntent`
- `ControlAction`
- `ExecutionCommand`
- `ExecutionEvent`

并补充了：

- TypeBox schema
- 最小构造函数
- 最小短指令解析：`继续 / 停一下 / 总结一下 / 只分析`

意义：

- 为后续把 chat-first 控制平面与 coding execution kernel 连接起来，提供标准协议层。

### 3. 新增任务状态帮助函数

已落地：

- `findLatestResumableTask`
- `countActiveTasksForConversation`
- `sortTasksByUpdatedDesc`

意义：

- 为后续实现“继续”语义提供一阶能力。

### 4. 单元测试

已新增测试：

- `src/task/types.test.ts`
- `src/task/protocol.test.ts`
- `src/task/state.test.ts`

意义：

- 先把核心语义钉住，再逐步接入现有主路径，避免后续重构时漂移。

## 这一步刻意没有做的事

本轮**刻意没有**直接改：

- 现有 session store
- 现有 sessions_spawn / subagents 执行路径
- 现有 message routing
- ACP runtime
- memory writeback 现有主流程

原因：

- 先把领域模型和协议层独立落地，风险最小
- 避免在未立稳对象模型前，把现有运行逻辑改散

## 下一步建议

### 下一刀：把 `TaskIntent` 和 `ControlAction` 接入聊天入口/路由层

优先目标：

- 让“继续”优先查找 conversation 下最近一个 resumable task
- 若命中 task，则不再把它当作普通新消息从零处理

### 再下一刀：把 `ExecutionCommand / ExecutionEvent` 接入一个最小 Kernel shim

优先目标：

- 先不做完整执行内核
- 先做一个 `planner` 风格的最小执行通路
- 验证控制平面 -> 协议层 -> 执行平面 的链路可跑通

## 当前判断

第一刀的目标不是“立刻完成功能”，而是：

> 先在 OpenClaw fork 中种下正确的对象模型与协议层，
> 让后续重构有清晰锚点，而不是继续在 prompt、tool、session 之间散着长功能。
