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

---

# 第二刀更新：最小 task-aware router shim

## 本轮新增

### 1. 新增 `src/task/router.ts`

已落地能力：

- 为 session 维护一个最小 `taskRouter.latestTask` 快照
- 当用户发起新的执行型请求时，记录最近 task
- 当用户发送 `继续` 时，若存在最近 task，则把消息重写为“恢复最近任务”的内部提示
- 当用户发送 `总结一下` 时，若存在最近 task，则把消息重写为“总结当前任务状态”的内部提示
- 当用户发送 `停一下` / `取消` 时，更新最近 task 状态
- 若未命中最近 task，则完全回退现有普通消息路径

### 2. 已接入聊天主路径

已接入位置：

- `src/auto-reply/reply/get-reply-run.ts`

接入方式：

- 在进入 `runReplyAgent(...)` 之前，先做一次轻量 task 路由判定
- 命中最近 task 时，重写 `commandBody`
- 命中最近 task 且走队列路径时，同步重写 `queuedBody`
- 把最新 `taskRouter` 快照写回 session store

这意味着：

- 现有 agent runtime、tool runtime、reply pipeline 基本未动
- 新行为被压缩在很小的 shim 里，风险与回滚成本都较低

### 3. 新增测试

新增：

- `src/task/router.test.ts`

当前 task 模块测试结果：

- `4` 个测试文件
- `14/14 tests passed`

## 当前限制

本轮仍是**最小可用版**，尚未做到：

- 真实 `TaskRecord` 持久化集合
- `继续第 N 个任务` 这类按编号/按 id 精确恢复
- 与 `ExecutionCommand / ExecutionEvent` 的完整 kernel 接线

---

# 第三刀更新：最小任务集合与任务列表闭环

## 本轮新增

### 1. 从 `latestTask` 扩展到 `recentTasks`

已落地能力：

- `taskRouter` 现在不仅维护 `latestTask`
- 还维护一个上限为 `5` 的 `recentTasks` 列表
- 新执行型请求会被插入到任务列表头部
- 已存在 task 会在更新状态时原位刷新并去重

这意味着：

- 不再只有“最近一个任务”的单点记忆
- 已具备最小 conversation 级任务索引能力

### 2. 新增“任务列表 / 列出任务”控制语义

已落地能力：

- 新增控制动作：`list_tasks`
- 识别：
  - `任务列表`
  - `列出任务`
  - `list tasks`
- 命中后会将消息改写为内部任务列表提示，要求 agent：
  - 用简明中文解释当前追踪任务
  - 指出最新活跃任务
  - 建议下一步继续什么

### 3. 基本功能闭环已形成

当前已具备的闭环：

1. 用户发起一个执行型请求（如“研究这个 repo 的 session 架构”）
2. 系统在 session store 中记录 `latestTask + recentTasks`
3. 用户再发：
   - `继续`
   - `总结一下`
   - `任务列表`
4. task router 先处理控制语义
5. 若命中任务，则改写为恢复/总结/列任务的内部提示
6. 再回到现有 `runReplyAgent(...)` 主路径执行

这已经形成：

> 用户控制语义 -> task router -> session task snapshot -> 现有 agent runtime

## 测试结果

当前 task 模块测试结果：

- `4` 个测试文件
- `15/15 tests passed`

新增覆盖：

- 任务列表构造
- `recentTasks` 持久化
- `继续` 时同步刷新 `recentTasks`

## 当前限制

当前闭环仍是**最小可用**，未完成部分包括：

- 真实任务表持久化（而非 session 内快照）
- 编号级任务控制（例如“继续第 2 个任务”）
- `ExecutionCommand / ExecutionEvent` 的真实 kernel 落地
- 任务完成/失败状态与真实执行结果的自动绑定

## 下一步建议

### 下一刀：真实任务记录层

优先目标：

- 把 session 内 `recentTasks` 升级为真实任务记录集合
- 支持更稳定的任务 id 与状态迁移

### 再下一刀：最小 execution kernel shim

优先目标：

- 让恢复/总结不仅是 prompt rewrite
- 而是开始进入标准化 `ExecutionCommand / ExecutionEvent` 通路

---

# 后续增量更新：run snapshot、pause/cancel 与 active-run-aware 收口

## 已完成追加

### 1. `继续 / 总结一下` 的 run snapshot 写回

已落地：

- `Task` 快照开始记住最近一次 run session 的：
  - `run session id`
  - `run status / phase`
  - `agent profile`
- reply flow 在运行开始 / 总结阶段 / 正常结束 / 异常结束时，做最小状态写回

已固定的最小映射：

- 运行开始 → `running`
- 总结阶段 → `summarizing`
- 正常结束 → `waiting_user`
- 异常结束 → `failed`

### 2. `停一下 / 取消` 的最小真实接线

已落地：

- `停一下`
  - 不强杀底层执行
  - task 状态写回为 `waiting_user`
  - latest run snapshot 写回为 `paused`
- `取消`
  - 优先复用既有 abort 链路
  - 尝试调用 `abortEmbeddedPiRun(...)`
  - 清理 command lane
  - task / run snapshot 写回为 `cancelled`

### 3. 收紧 pause / cancel / continue 的恢复语义

已落地：

- `继续` 不再误恢复：
  - `cancelled`
  - `completed`
  - `failed`
    的 latest task
- 若 latest task 不可恢复，但 `recentTasks` 中仍有最近可恢复任务，则回退恢复那个
- `取消` 会写 `abortedLastRun = true`
- `停一下` 不会污染 `abortedLastRun`

### 4. 新增 active-run-aware 最小收口

已落地：

- reply flow 新增最小 `active task run` 判定：
  - 基于当前会话 `sessionId`
  - 结合 embedded run 是否 active
  - 与当前 `latestTask` 做轻量对齐
- `继续` 命中最近任务、且当前 embedded run 仍 active 时：
  - 不再重复新开一轮执行
  - 直接返回确认消息，引导用户用“总结一下”查看现状
- `取消` 仅在 embedded run 确实 active 时才执行真实 abort；若无 active run，则退化为 snapshot-only cancel

## 当前结果

截至这一版，Route A 在 chat-first 主路径上已形成：

1. task domain / protocol scaffold
2. task-aware router shim
3. `继续 / 总结一下` 的 run snapshot 写回
4. `停一下 / 取消` 的最小接线
5. `pause / cancel / continue` 的恢复语义收紧
6. `continue / cancel` 的 active-run-aware 最小执行判断

## 测试结果

当前定向回归结果为：

- `src/task/types.test.ts`
- `src/task/protocol.test.ts`
- `src/task/state.test.ts`
- `src/task/router.test.ts`
- `src/auto-reply/reply/get-reply-run.media-only.test.ts`

结果：

- `5` 个测试文件
- `36/36 tests passed`

## 当前判断

这一阶段的主聊天通路已经从“只记住最近任务”推进为：

> 不仅能记住最近任务，也开始能区分“最近任务快照”与“当前是否真有 embedded run 还在跑”，并据此让 `继续 / 取消` 的行为更贴近真实运行态。
