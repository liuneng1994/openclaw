# 2026-03-12 Route A 手动验收计划

## 目标

验证 OpenClaw Route A 当前阶段的 **task-aware control + chat-first approval loop** 主线，在真实运行环境中的行为是否符合设计。

本轮只制定手动验收计划，不执行验收动作。

---

## 验收范围

### A. task-aware control

- `继续`
- `总结一下`
- `任务列表 / 列出任务`
- `停一下`
- `取消`

### B. approval loop

- 高风险动作触发确认
- `确认执行 / 可以执行 / 执行吧`
- `先别执行 / 暂停这个`

### C. approval lifecycle

- binding / fallback
- two-phase consumption
- cleanup policy
- TTL policy
- `lastApprovalOutcome`
- summary/task-list readout

---

## 验收环境原则

### 1. 必须使用隔离 dev 实例

不要直接拿当前主实例做实验。

建议固定：

- 仓库：`/root/dev/openclaw`
- 配置：`OPENCLAW_CONFIG_PATH=/root/.openclaw-dev/openclaw.json`

### 2. 尽量先跳过真实渠道

第一轮优先：

- 本地 gateway
- 本地 Control UI / session 读数
- 本地 chat/reply path

真实 Telegram 验证放第二轮。

### 3. 只做手动验收，不夹带新实现

本轮目标是：

- 发现问题
- 记录现象
- 分类缺陷
- 不边测边改

---

## 验收前检查清单

开始前先确认：

- [ ] 当前运行的是 `/root/dev/openclaw`
- [ ] 不是主实例，而是 dev 实例
- [ ] gateway 能正常启动
- [ ] Control UI 能连上正确 gateway
- [ ] session 能看到目标会话
- [ ] 当前代码基线已记录（commit hash）
- [ ] 当前验收目标文档/记录文件已准备好

建议先记录：

- 验收时间
- 代码提交 hash
- 配置路径
- gateway 地址
- UI 地址

---

## 手动验收分组

### 组 1：基础 task control

目标：确认 task-aware router 基本闭环成立。

#### 用例 1.1：新建执行型任务

**步骤**

1. 发一个明确执行型请求，例如：
   - “帮我分析这个仓库的任务控制逻辑”
   - “run tests”
   - “修改一个小功能”
2. 等系统开始处理

**预期**

- 会创建/更新 latest task
- recentTasks 中能看到该任务
- summary/task list 后续能引用它

#### 用例 1.2：继续

**步骤**

1. 在已有可恢复 task 后发送：
   - `继续`

**预期**

- 不被当成普通全新请求
- 命中最近可恢复 task
- 进入恢复语义
- 不重复新建不必要的独立任务

#### 用例 1.3：总结一下

**步骤**

1. 在已有 task 后发送：
   - `总结一下`

**预期**

- 返回当前 task 的阶段、进度、阻塞、建议下一步
- 若有 approval 状态，应带轻量 readout

#### 用例 1.4：任务列表

**步骤**

1. 在已有多个 recent tasks 后发送：
   - `任务列表`
   - 或 `列出任务`

**预期**

- 列出 recent tasks
- latest task 若有关联 approval 状态，显示轻量标记
- 非 latest task 不应被过度污染

#### 用例 1.5：停一下

**步骤**

1. 在运行中或可恢复 task 上发送：
   - `停一下`

**预期**

- task 进入 `waiting_user / paused` 语义
- 不强制破坏不该破坏的底层状态
- 后续 `继续` 仍可恢复

#### 用例 1.6：取消

**步骤**

1. 在运行中 task 上发送：
   - `取消`

**预期**

- task 标为 cancelled
- 若有 active embedded run，尝试中断
- 后续 `继续` 不应误恢复已取消任务

---

### 组 2：高风险动作触发确认

目标：确认 ask / confirm / reject 主链成立。

#### 用例 2.1：git 高风险动作触发确认

**步骤**

1. 发一个会触发 git mutation 倾向的请求，例如：
   - “改完后直接 git commit”
   - “帮我 commit 这些变更”

**预期**

- 命中 runtime gate
- 出现确定性确认提示
- 生成 `pendingApproval.kind = git`

#### 用例 2.2：external 高风险动作触发确认

**步骤**

1. 发一个会触发外部发送/写入的请求，例如：
   - “直接发消息给某人”
   - “帮我执行外部发送动作”

**预期**

- 命中 runtime gate
- 出现确认提示
- 生成 `pendingApproval.kind = external`

#### 用例 2.3：确认执行

**步骤**

1. 在有 pending approval 时发送：
   - `确认执行`
   - 或 `可以执行`
   - 或 `执行吧`

**预期**

- 命中 confirm_execution
- approval 进入 `resuming`
- 恢复 task
- 本次恢复为一次性放行
- 不形成永久提权

#### 用例 2.4：拒绝执行

**步骤**

1. 在有 pending approval 时发送：
   - `先别执行`
   - 或 `暂停这个`

**预期**

- approval 被清掉
- task 留在 `waiting_user`
- 不新开 run
- `lastApprovalOutcome = rejected`

---

### 组 3：确认绑定语义

目标：确认 approval 不会漂到错误任务上。

#### 用例 3.1：精确绑定恢复

**步骤**

1. 触发 approval
2. 不改变上下文，直接发送 `确认执行`

**预期**

- 精确命中原 task/run
- 正常恢复

#### 用例 3.2：runSession 漂移但同 task fallback

**步骤**

1. 触发 approval
2. 让 task 进入可恢复但 run snapshot 有轻微变化
3. 再确认执行

**预期**

- 若仍是同一 task，可保守 fallback 恢复
- 不因轻微 run 漂移而完全失效

#### 用例 3.3：上下文失配拒绝恢复

**步骤**

1. 触发 approval
2. 切换到别的 task 或让原 task 不再可恢复
3. 再发送 `确认执行`

**预期**

- 不继续执行
- 返回“上下文已经变化”类提示
- `lastApprovalOutcome = context_mismatch`

---

### 组 4：approval 生命周期

目标：确认 approval 不会重复复用，也不会变僵尸状态。

#### 用例 4.1：two-phase consumption

**步骤**

1. 触发 approval
2. 确认执行
3. 观察恢复后状态

**预期**

- `pending -> resuming`
- 恢复 turn 后被消费
- `lastApprovalOutcome = consumed`

#### 用例 4.2：重复确认不复用

**步骤**

1. 在 approval 已进入 `resuming` 后再次发：
   - `确认执行`

**预期**

- 不重复放行
- 返回重复确认提示
- 不再触发新的恢复

#### 用例 4.3：新任务清旧 approval

**步骤**

1. 触发 pending approval
2. 不确认，直接发一个新的 execution-bearing task

**预期**

- 旧 approval 被清掉
- 不会漂到新任务上

#### 用例 4.4：cancel 清理 resuming

**步骤**

1. 让 approval 进入 `resuming`
2. 中途取消运行

**预期**

- approval 被清掉
- `lastApprovalOutcome = cancelled`

#### 用例 4.5：terminal clear

**步骤**

1. 有 approval 绑定到某 task
2. 让该 task 进入 completed / failed / cancelled

**预期**

- approval 被清掉
- `lastApprovalOutcome = terminal_cleared`

---

### 组 5：过期语义

目标：确认 stale approval 不再可复用。

#### 用例 5.1：pending TTL

**步骤**

1. 触发 pending approval
2. 等待或模拟超过 30 分钟
3. 发送 `确认执行`

**预期**

- 不恢复
- 返回“已失效”提示
- `lastApprovalOutcome = expired`

#### 用例 5.2：resuming TTL

**步骤**

1. 让 approval 进入 `resuming`
2. 等待或模拟超过 5 分钟
3. 再执行 `确认执行 / 继续 / 总结一下`

**预期**

- stale approval 被清掉
- 不再复用它
- 普通 control 按自己的语义走

---

### 组 6：状态可读性

目标：确认 approval 状态已经对用户轻量可见。

#### 用例 6.1：summary readout

**步骤**

1. 让 latest task 带有 pending approval
2. 发送：
   - `总结一下`

**预期**

- summary 中能体现 approval 状态
- 表达简短，不像 debug dump

#### 用例 6.2：task list readout

**步骤**

1. recent tasks 至少两个
2. latest task 具备 pendingApproval 或 lastApprovalOutcome
3. 发送：
   - `任务列表`

**预期**

- 只对 latest task 显示轻量 approval 标记
- 列表整体仍可读

---

## 验收记录模板

建议每个用例按这个格式记录：

- **用例编号**
- **输入**
- **前置状态**
- **预期**
- **实际**
- **是否通过**
- **证据**
  - 截图
  - session snapshot
  - 日志
  - commit hash
- **备注**

---

## 通过标准

### P0 必过

- continue / summary / task list
- git/external approval prompt
- confirm / reject
- cancel 不误恢复
- 上下文失配不误放行

### P1 建议通过

- two-phase consumption
- cleanup policy
- ttl policy
- readout surfacing

### 可接受暂缓

- 更复杂 UI 展示
- 更多渠道面一致性
- 更系统的观测页

---

## 建议执行顺序

1. **基础 task control**
2. **approval 触发与 confirm/reject**
3. **binding / cleanup**
4. **ttl**
5. **summary / task-list readout**
6. **最后再看 Telegram 最小实链**

---

## 当前建议

下一步可以从以下两种产物中二选一：

1. 按本计划执行一次隔离 dev 实例手动验收
2. 基于本计划再压缩出一份更适合边测边勾的 checklist
