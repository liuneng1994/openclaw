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

---

# 新增推进：Execution Kernel Seam / Shim（最小版）

## 已完成追加

### 1. 新增最小 execution kernel 规划层

已落地：

- 新增 `src/task/kernel.ts`
- 将 task router 的结果提升为结构化 execution plan：
  - `ExecutionCommand`
  - `ExecutionEvent[]`
  - 可注入现有 agent runtime 的 `promptText`

当前已支持的最小 command 映射：

- 新执行型请求 → `start_session`
- `继续` → `resume_session`
- `总结一下` → `request_summary`
- `只分析` → `apply_permission_update`

### 2. 已把 execution kernel seam 接入 reply 主路径

已落地：

- 在 `src/auto-reply/reply/get-reply-run.ts` 中，task router 决策后会进一步生成 execution kernel 计划
- 当命中 execution-bearing task 时：
  - `commandBody` 会被注入 `[Execution Kernel]` 结构化控制信息
  - `followupRun.prompt` 也会同步带上同样的 execution kernel 元数据

这意味着：

- 当前系统不再只靠 `[Task Router]` prompt rewrite 驱动恢复/总结
- 而是开始拥有一条最小的：
  - `TaskIntent / ControlAction`
  - → `ExecutionCommand / ExecutionEvent`
  - → 现有 reply runtime
    的协议接缝

### 3. 新增测试覆盖

已新增：

- `src/task/kernel.test.ts`

新增覆盖点：

- new execution task → `start_session`
- `继续` → `resume_session`
- `总结一下` → `request_summary`
- non execution-bearing task → no kernel plan
- `get-reply-run` 对 execution kernel metadata 的主路径注入

## 最新测试结果

当前定向回归结果为：

- `src/task/types.test.ts`
- `src/task/protocol.test.ts`
- `src/task/state.test.ts`
- `src/task/router.test.ts`
- `src/task/kernel.test.ts`
- `src/auto-reply/reply/get-reply-run.media-only.test.ts`

结果：

- `6` 个测试文件
- `41/41 tests passed`

## 阶段判断

截至这一版，Route A 已经从：

> 仅有 task snapshot + task-aware control shim

推进到：

> 拥有一个最小 execution kernel seam，能够把聊天控制语义结构化成 execution command/event，并注入现有 reply runtime 继续执行。

---

# 2026-03-12 后续推进：approval loop 收口、readout surfacing 与 latest run 统一视图

## 已完成追加

### 1. chat-first approval loop 已形成完整最小闭环

已落地：

- `git` / `external` 高风险动作会在 runtime gate 命中后生成 `pendingApproval`
- approval state 保持在 `SessionEntry.taskRouter.pendingApproval`
- 用户可直接使用：
  - `确认执行`
  - `可以执行`
  - `执行吧`
  - `先别执行`
  - `暂停这个`
- `confirm_execution` 会恢复最近可恢复任务，并带一次性放行的 execution policy 继续执行
- `reject_execution` 会清掉 approval，保持任务 `waiting_user`

本轮关键提交：

- `cc604e899` — `feat: add chat-first approval loop for runtime policy gates`

### 2. approval 恢复语义已收紧为“精确绑定 + 保守回退”

已落地：

- `确认执行` 优先绑定：
  - `taskId`
  - `runSessionId`
  - approval `kind`
- 若 run session 漂移，但仍为同一 task，则允许保守 fallback
- 若上下文失配，则明确拒绝恢复

关键提交：

- `f30072257` — `feat: tighten chat-first approval resume binding`

### 3. approval 生命周期已形成两阶段消费 + cleanup + TTL

已落地：

- 两阶段消费：
  - `pending`
  - `resuming`
  - `consumed / cleared`
- cleanup policy：
  - 新任务清旧 approval
  - task 终态清 approval
  - cancel 清 `resuming`
  - continue / summary 不复活 stale approval
- TTL：
  - `pending` = 30 分钟
  - `resuming` = 5 分钟

关键提交：

- `8357c804a` — `feat: add two-phase approval consumption state`
- `16d9c4209` — `feat: add approval cleanup policy guards`
- `7d2d812f4` — `feat: add approval ttl policy`

### 4. approval 的用户面与观测面已收口

已落地：

- 统一 approval UX 文案：
  - 已失效
  - 上下文失配
  - 重复确认
  - 拒绝执行
- 新增 `lastApprovalOutcome`：
  - `rejected`
  - `consumed`
  - `expired`
  - `context_mismatch`
  - `cancelled`
  - `terminal_cleared`

关键提交：

- `f083acc76` — `feat: unify approval ux messaging`
- `8e62b946d` — `feat: surface approval outcome status`

### 5. approval / run 状态已开始对外轻量可读

已落地：

- `总结一下` 会带：
  - latest run readout
  - approval readout
- `任务列表` 会只对 latest task 增加轻量标记：
  - approval readout
  - latest run phase/profile readout

关键提交：

- `e1aa5b5b8` — `feat: surface approval readouts in task prompts`
- `f6ae69011` — `feat: surface latest run phase in task readouts`

### 6. latest run 统一视图 helper 已落地

已落地：

- `src/task/state.ts` 新增：
  - `getLatestRunSnapshot(...)`
  - `getLatestRunSessionId(...)`
  - `updateTaskLatestRunSnapshot(...)`
- `router.ts` / `kernel.ts` / run progress 写回已改为走统一 latest run 视图

这意味着：

- latest run 不再只是到处手搓字段
- `summary / continue / approval / run progress / execution kernel` 已围绕同一套 run-state seam 读写

关键提交：

- `aa5c1a05c` — `feat: normalize latest run session state helpers`

### 7. 文档与手动验收计划已补齐

已落地：

- 新增手动验收计划：
  - `/root/dev/openclaw/docs/plans/2026-03-12-route-a-manual-validation-plan.md`

关键提交：

- `14c00a038` — `docs: add route A manual validation plan`

## 当前测试基线

当前完整定向回归结果：

- `src/task/types.test.ts`
- `src/task/protocol.test.ts`
- `src/task/state.test.ts`
- `src/task/router.test.ts`
- `src/task/kernel.test.ts`
- `src/auto-reply/reply/agent-runner-utils.test.ts`
- `src/auto-reply/reply/get-reply-run.media-only.test.ts`
- `src/agents/pi-embedded-runner/run/attempt.test.ts`

结果：

- `8` 个测试文件
- `130/130 tests passed`

## 当前判断

截至当前版本，Route A 的这条主线已经从：

> task-aware control + minimal execution seam

推进到：

> 拥有 chat-first approval loop、lifecycle management、approval/readout surfacing，以及 latest run 统一视图的控制平面雏形。

仍未完全做深的部分主要是：

- 更完整的 RunSession 独立对象层
- 更工程化的 summary/status 输出
- 隔离 dev 实例下的真实链路手动验收
