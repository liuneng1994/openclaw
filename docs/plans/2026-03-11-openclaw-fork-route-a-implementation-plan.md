# OpenClaw Fork 路线 A 实施计划

> 日期：2026-03-11
> 目标：在 OpenClaw fork 上，以“控制平面 / 执行平面分离”的路线，逐步实现聊天优先的编码代理架构。

## 1. 总原则

- **不推倒重来**：保留 OpenClaw 现有 chat-first、session orchestration、memory、skills、channel-aware policy 能力。
- **增量重构**：先补一层 execution kernel，而不是先大改所有现有流程。
- **先立 Task，再立 Kernel**：先把 Conversation / Task / RunSession 三者分离，再逐步把编码执行从普通会话逻辑中抽出。
- **先单入口验证**：第一阶段只在 Telegram 场景验证，不急于多渠道并进。

---

## 2. 第一期目标（MVP）

第一期只解决一个核心问题：

> 让 OpenClaw fork 可以从聊天里稳定发起、追踪并继续一个“编码任务”，而不是只处理一串消息。

### MVP 交付物

1. `Task` 一等对象
2. `RunSession` 一等对象（至少 root session）
3. 基础 `Execution Kernel`
4. 最小 `AgentProfile` 集合：planner / researcher / builder / summarizer
5. 最小 `ExecutionCommand / ExecutionEvent` 协议
6. 最小 `Permission Engine`
7. 最小 `Task Memory`
8. Telegram 场景下的 `继续 / 停一下 / 总结一下`

---

## 3. 模块拆解与顺序

### Phase 0：代码勘察与切入点确认

任务：

- 确认 OpenClaw fork 的实际源码目录
- 梳理现有 session / subagent / ACP / message / memory 相关代码
- 标出最适合承载 `Task` 和 `Execution Kernel` 的模块边界

产出：

- 一份源码映射表
- 一份“尽量别动的现有模块”清单
- 一份建议新增目录/模块清单

### Phase 1：对象层落地

任务：

- 新增 `Task` 数据模型
- 新增 `RunSession` 数据模型
- 定义 task 状态机
- 建立 conversation -> task 映射
- 支持查询最近活跃 task

完成标准：

- 用户说“继续”时，系统能定位正确 task

### Phase 2：协议层落地

任务：

- 定义 `TaskIntent`
- 定义 `ExecutionPlan`
- 定义 `ExecutionCommand`
- 定义 `ExecutionEvent`
- 定义 `ControlAction`

完成标准：

- 控制平面与执行平面可以通过结构化协议交互，而不是共享隐式状态

### Phase 3：Execution Kernel MVP

任务：

- 新增 `AgentProfile`
- 实现 `planner / researcher / builder / summarizer`
- 支持 root run session 执行
- 支持最小 child session spawn（可选）
- 支持结构化 summary artifact

完成标准：

- 能完成一次研究任务
- 能完成一次小型改码任务

### Phase 4：工具与权限收敛

任务：

- 收拢 coding 相关工具：read/search/edit/run_command/git_status/git_diff
- 定义统一 tool result schema
- 实现 allow/ask/deny
- 引入 profile baseline + task overlay + once grant

完成标准：

- 常规读写自动执行
- 高风险动作触发 ask

### Phase 5：聊天体验打磨

任务：

- 让 `继续 / 停一下 / 总结一下` 变成 ControlAction
- 补充状态消息与摘要回报
- 增加基础 approval flow

完成标准：

- 聊天里多轮协作自然连贯

---

## 4. 建议新增的抽象

建议新增以下概念或模块：

- `task/`
- `execution/`
- `execution/agent-profile`
- `execution/kernel`
- `execution/protocol`
- `execution/runtime`
- `permission/engine`（若现有权限模型不适配，可在其上扩）
- `memory/task-memory`

注意：

- 命名应以现有 OpenClaw 代码风格为准
- 若已有相近模块，应优先“顺着已有结构生长”，不要生硬平行造轮子

---

## 5. 第一周建议节奏

### Day 1

- 勘察源码结构
- 画出现有 session/message/subagent/memory 关系
- 产出源码切入点说明

### Day 2

- 落地 `Task` / `RunSession` 数据结构
- 打通 conversation -> task 查询

### Day 3

- 定义协议层：TaskIntent / ExecutionCommand / ExecutionEvent / ControlAction
- 完成最小 Task Router

### Day 4

- 落地 Execution Kernel MVP（planner / researcher / summarizer）
- 跑通研究任务链路

### Day 5

- 加 builder
- 接入最小 coding tool runtime
- 跑通一次小型改码任务

### Day 6

- 接入 Permission Engine MVP
- 支持 ask/allow/deny

### Day 7

- 打磨 Telegram 场景：继续 / 停一下 / 总结一下
- 补充 demo / 验收记录

---

## 6. 验收标准

MVP 验收至少满足：

1. 用户从 Telegram 发起一个 repo 研究任务
2. 系统创建 task 与 root run session
3. 系统能返回阶段性摘要
4. 用户发送“继续”时，系统能继续原 task
5. 用户发起小型改码任务时，系统能在 permission 规则下自动执行低风险动作
6. 高风险动作能正确 ask
7. 任务完成后可输出结构化 summary

---

## 7. 当前阻塞

当前工作区尚未看到 OpenClaw fork 源码树本体，因此还不能真正开始改代码。

要进入实施，需要先满足其一：

1. 提供现有 OpenClaw fork 代码路径；或
2. 把您的 OpenClaw fork 仓库克隆到工作区，再开始实施。

在源码到位前，当前文档计划已经完成；真正的代码实施需在源码树中进行。
