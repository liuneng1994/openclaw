import type { SessionEntry } from "../config/sessions.js";
import { mergeSessionEntryPreserveActivity } from "../config/sessions.js";
import {
  inferControlAction,
  inferTaskIntent,
  type ControlAction,
  type TaskIntent,
} from "./protocol.js";
import {
  getLatestRunSessionId,
  getLatestRunSnapshot,
  updateTaskLatestRunSnapshot,
} from "./state.js";
import {
  deriveTaskTitle,
  isResumableTaskStatus,
  resolveAgentProfileForTaskKind,
  resolveRunSessionStatusForTaskKind,
  type TaskRecord,
} from "./types.js";

const MAX_RECENT_TASKS = 5;
const PENDING_APPROVAL_TTL_MS = 30 * 60 * 1000;
const RESUMING_APPROVAL_TTL_MS = 5 * 60 * 1000;

export type TaskPendingApproval = {
  kind: "git" | "external";
  status: "pending" | "resuming";
  taskId?: string;
  runSessionId?: string;
  summary: string;
  createdAt: number;
  resumingAt?: number;
};

export type TaskApprovalOutcome = {
  kind: "git" | "external";
  taskId?: string;
  runSessionId?: string;
  summary?: string;
  outcome:
    | "rejected"
    | "consumed"
    | "expired"
    | "context_mismatch"
    | "cancelled"
    | "terminal_cleared";
  updatedAt: number;
};

export type TaskRouterSnapshot = {
  latestTask?: TaskRecord;
  recentTasks?: TaskRecord[];
  pendingApproval?: TaskPendingApproval;
  lastApprovalOutcome?: TaskApprovalOutcome;
};

export type PendingApprovalResolution = {
  approval: TaskPendingApproval;
  task: TaskRecord;
  resolution: "exact" | "fallback";
};

export type TaskRouterDecision = {
  taskIntent: TaskIntent;
  controlAction: ControlAction | null;
  rewrittenText: string;
  snapshot: TaskRouterSnapshot;
  matchedExistingTask: boolean;
  pendingApprovalResolution?: PendingApprovalResolution;
};

function createTaskId(conversationId: string, text: string): string {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32) || "task";
  return `task:${conversationId}:${normalized}`;
}

function createRunSessionId(taskId: string): string {
  return `run:${taskId}:${Date.now()}`;
}

function cloneTask(task: TaskRecord): TaskRecord {
  return { ...task };
}

function buildRunSnapshotLines(task: TaskRecord): string[] {
  const run = getLatestRunSnapshot(task);
  if (!run) {
    return [];
  }
  return [
    `Run Session ID: ${run.id}`,
    `Run Session Status: ${run.status}`,
    `Run Agent Profile: ${run.agentProfile}`,
  ];
}

function buildResumePrompt(task: TaskRecord): string {
  return [
    "[Task Router]",
    "The user asked to continue the latest resumable task in this conversation.",
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Task Kind: ${task.kind}`,
    `Task Status: ${task.status}`,
    ...buildRunSnapshotLines(task),
    "Instruction: Resume this task from the latest known context instead of treating the message as a brand-new request.",
    "Original user message: 继续",
  ].join("\n");
}

function formatApprovalKind(kind: "git" | "external"): string {
  return kind === "git" ? "git 变更" : "外部动作";
}

function buildApprovalReadoutLines(snapshot: TaskRouterSnapshot, task: TaskRecord): string[] {
  const lines: string[] = [];
  if (snapshot.pendingApproval && snapshot.pendingApproval.taskId === task.id) {
    lines.push(
      `Pending Approval: ${snapshot.pendingApproval.status} (${formatApprovalKind(snapshot.pendingApproval.kind)})`,
    );
  }
  if (snapshot.lastApprovalOutcome && snapshot.lastApprovalOutcome.taskId === task.id) {
    lines.push(
      `Last Approval Outcome: ${snapshot.lastApprovalOutcome.outcome} (${formatApprovalKind(snapshot.lastApprovalOutcome.kind)})`,
    );
  }
  return lines;
}

function buildSummaryPrompt(task: TaskRecord, snapshot: TaskRouterSnapshot): string {
  return [
    "[Task Router]",
    "The user asked for a summary of the latest active/resumable task in this conversation.",
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Task Kind: ${task.kind}`,
    `Task Status: ${task.status}`,
    ...buildRunSnapshotLines(task),
    ...buildApprovalReadoutLines(snapshot, task),
    "Instruction: Summarize the current task state, progress, blockers, and recommended next step. When approval readouts are present, briefly explain them in concise Chinese.",
    "Original user message: 总结一下",
  ].join("\n");
}

function buildTaskListPrompt(tasks: TaskRecord[], snapshot: TaskRouterSnapshot): string {
  const lines = tasks.map((task, index) => {
    const approvalHints = buildApprovalReadoutLines(snapshot, task);
    const suffix = index === 0 && approvalHints.length > 0 ? ` | ${approvalHints.join(" | ")}` : "";
    return `${index + 1}. [${task.status}] ${task.title} (id=${task.id}, kind=${task.kind})${suffix}`;
  });
  return [
    "[Task Router]",
    "The user asked to list the recent tracked tasks in this conversation.",
    "Instruction: Explain the current tracked tasks in concise Chinese, identify the latest active task, and suggest what to continue next.",
    "Tracked tasks:",
    ...lines,
    "Original user message: 任务列表",
  ].join("\n");
}

function buildApprovalConfirmPrompt(
  task: TaskRecord,
  approval: TaskPendingApproval,
  resolution: PendingApprovalResolution["resolution"],
): string {
  return [
    "[Task Router]",
    "The user explicitly confirmed a previously blocked high-risk action.",
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Approval Kind: ${approval.kind}`,
    `Approval Summary: ${approval.summary}`,
    `Approval Resolution: ${resolution}`,
    approval.runSessionId ? `Pending Run Session ID: ${approval.runSessionId}` : undefined,
    getLatestRunSnapshot(task)?.id
      ? `Resolved Run Session ID: ${getLatestRunSnapshot(task)?.id}`
      : undefined,
    "Instruction: Resume the task and continue past the previously blocked action. The user has confirmed execution for this pending approval.",
    "Original user message: 确认执行",
  ]
    .filter(Boolean)
    .join("\n");
}

function upsertRecentTasks(tasks: TaskRecord[], nextTask: TaskRecord): TaskRecord[] {
  const deduped = tasks.filter((task) => task.id !== nextTask.id);
  return [cloneTask(nextTask), ...deduped].slice(0, MAX_RECENT_TASKS);
}

function updateExistingTaskStatus(
  tasks: TaskRecord[],
  taskId: string | undefined,
  mutate: (task: TaskRecord) => TaskRecord,
): TaskRecord[] {
  if (!taskId) {
    return tasks;
  }
  return tasks.map((task) => (task.id === taskId ? mutate(task) : task));
}

function normalizeSnapshot(snapshot: TaskRouterSnapshot | undefined): TaskRouterSnapshot {
  return {
    latestTask: snapshot?.latestTask ? cloneTask(snapshot.latestTask) : undefined,
    recentTasks: snapshot?.recentTasks?.map(cloneTask) ?? [],
    pendingApproval: snapshot?.pendingApproval ? { ...snapshot.pendingApproval } : undefined,
    lastApprovalOutcome: snapshot?.lastApprovalOutcome
      ? { ...snapshot.lastApprovalOutcome }
      : undefined,
  };
}

function buildApprovalOutcome(
  approval: TaskPendingApproval,
  outcome: TaskApprovalOutcome["outcome"],
  updatedAt: number,
): TaskApprovalOutcome {
  return {
    kind: approval.kind,
    taskId: approval.taskId,
    runSessionId: approval.runSessionId,
    summary: approval.summary,
    outcome,
    updatedAt,
  };
}

function findLatestResumableTask(snapshot: TaskRouterSnapshot): TaskRecord | undefined {
  if (snapshot.latestTask && isResumableTaskStatus(snapshot.latestTask.status)) {
    return snapshot.latestTask;
  }
  return snapshot.recentTasks?.find((task) => isResumableTaskStatus(task.status));
}

function findTaskById(
  snapshot: TaskRouterSnapshot,
  taskId: string | undefined,
): TaskRecord | undefined {
  if (!taskId) {
    return undefined;
  }
  if (snapshot.latestTask?.id === taskId) {
    return snapshot.latestTask;
  }
  return snapshot.recentTasks?.find((task) => task.id === taskId);
}

function matchesApprovalRun(task: TaskRecord, approval: TaskPendingApproval): boolean {
  if (!approval.runSessionId) {
    return true;
  }
  return getLatestRunSessionId(task) === approval.runSessionId;
}

function isTerminalTaskStatus(status: TaskRecord["status"] | undefined): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function isPendingApprovalExpired(approval: TaskPendingApproval | undefined, now: number): boolean {
  if (!approval) {
    return false;
  }
  if (approval.status === "pending") {
    return now - approval.createdAt > PENDING_APPROVAL_TTL_MS;
  }
  const startedAt = approval.resumingAt ?? approval.createdAt;
  return now - startedAt > RESUMING_APPROVAL_TTL_MS;
}

function shouldClearApprovalForTask(
  approval: TaskPendingApproval | undefined,
  task: TaskRecord | undefined,
): boolean {
  if (!approval?.taskId || !task || approval.taskId !== task.id) {
    return false;
  }
  return isTerminalTaskStatus(task.status);
}

function resolvePendingApprovalTask(
  snapshot: TaskRouterSnapshot,
  approval: TaskPendingApproval | undefined,
): PendingApprovalResolution | undefined {
  if (!approval?.taskId || approval.status !== "pending") {
    return undefined;
  }

  const exactTask = findTaskById(snapshot, approval.taskId);
  if (
    exactTask &&
    isResumableTaskStatus(exactTask.status) &&
    matchesApprovalRun(exactTask, approval)
  ) {
    return {
      approval,
      task: exactTask,
      resolution: "exact",
    };
  }

  const resumableTask = findLatestResumableTask(snapshot);
  if (
    resumableTask &&
    resumableTask.id === approval.taskId &&
    isResumableTaskStatus(resumableTask.status)
  ) {
    return {
      approval,
      task: resumableTask,
      resolution: "fallback",
    };
  }

  return undefined;
}

function withTaskRouterSnapshot(
  entry: SessionEntry | undefined,
  snapshot: TaskRouterSnapshot,
): SessionEntry {
  return mergeSessionEntryPreserveActivity(entry, {
    taskRouter: snapshot,
  });
}

export function resolveTaskRouterDecision(input: {
  text: string;
  conversationId: string;
  sessionEntry?: SessionEntry;
}): TaskRouterDecision {
  const taskIntent = inferTaskIntent({
    text: input.text,
    conversationId: input.conversationId,
  });
  const controlAction = inferControlAction({
    text: input.text,
    conversationId: input.conversationId,
  });
  const snapshot = normalizeSnapshot(input.sessionEntry?.taskRouter);
  const now = Date.now();
  let latestTask = snapshot.latestTask;
  let recentTasks = snapshot.recentTasks ?? [];
  let pendingApproval = snapshot.pendingApproval;
  let lastApprovalOutcome = snapshot.lastApprovalOutcome;
  const expiredApproval = isPendingApprovalExpired(pendingApproval, now)
    ? pendingApproval
    : undefined;
  if (expiredApproval) {
    pendingApproval = undefined;
    lastApprovalOutcome = buildApprovalOutcome(expiredApproval, "expired", now);
  } else if (shouldClearApprovalForTask(pendingApproval, latestTask)) {
    lastApprovalOutcome = buildApprovalOutcome(pendingApproval!, "terminal_cleared", now);
    pendingApproval = undefined;
  }
  let rewrittenText = input.text;
  let matchedExistingTask = false;
  let pendingApprovalResolution: PendingApprovalResolution | undefined;
  const resumableTask = findLatestResumableTask({
    latestTask,
    recentTasks,
    pendingApproval,
  });

  if (
    pendingApproval?.status === "resuming" &&
    controlAction?.type !== "confirm_execution" &&
    controlAction?.type !== "reject_execution"
  ) {
    lastApprovalOutcome = buildApprovalOutcome(pendingApproval, "expired", now);
    pendingApproval = undefined;
  }

  if (controlAction?.type === "confirm_execution" && pendingApproval) {
    pendingApprovalResolution = resolvePendingApprovalTask(snapshot, pendingApproval);
    if (pendingApprovalResolution) {
      latestTask = {
        ...pendingApprovalResolution.task,
        status: "running",
        updatedAt: now,
      };
      recentTasks = upsertRecentTasks(recentTasks, latestTask);
      rewrittenText = buildApprovalConfirmPrompt(
        latestTask,
        pendingApprovalResolution.approval,
        pendingApprovalResolution.resolution,
      );
      pendingApproval = {
        ...pendingApprovalResolution.approval,
        status: "resuming",
        resumingAt: now,
      };
      matchedExistingTask = true;
    }
  } else if (controlAction?.type === "reject_execution" && pendingApproval && latestTask) {
    latestTask = {
      ...latestTask,
      status: "waiting_user",
      updatedAt: now,
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    lastApprovalOutcome = buildApprovalOutcome(pendingApproval, "rejected", now);
    pendingApproval = undefined;
    matchedExistingTask = true;
  } else if (controlAction?.type === "continue" && resumableTask) {
    latestTask = {
      ...resumableTask,
      status: "running",
      updatedAt: now,
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    rewrittenText = buildResumePrompt(latestTask);
    matchedExistingTask = true;
  } else if (controlAction?.type === "request_summary" && resumableTask) {
    latestTask = {
      ...resumableTask,
      updatedAt: now,
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    rewrittenText = buildSummaryPrompt(latestTask, {
      latestTask,
      recentTasks,
      pendingApproval,
      lastApprovalOutcome,
    });
    matchedExistingTask = true;
  } else if (controlAction?.type === "list_tasks") {
    rewrittenText = buildTaskListPrompt(recentTasks, {
      latestTask,
      recentTasks,
      pendingApproval,
      lastApprovalOutcome,
    });
    matchedExistingTask = recentTasks.length > 0;
  } else if (controlAction?.type === "pause" && latestTask) {
    latestTask = {
      ...latestTask,
      status: "waiting_user",
      updatedAt: now,
    };
    recentTasks = updateExistingTaskStatus(recentTasks, latestTask.id, () => latestTask!);
  } else if (taskIntent.kind === "cancel_task" && latestTask) {
    latestTask = {
      ...latestTask,
      status: "cancelled",
      updatedAt: now,
    };
    recentTasks = updateExistingTaskStatus(recentTasks, latestTask.id, () => latestTask!);
    if (shouldClearApprovalForTask(pendingApproval, latestTask)) {
      pendingApproval = undefined;
    }
  } else if (
    taskIntent.requiresExecution &&
    taskIntent.kind !== "resume_task" &&
    taskIntent.kind !== "cancel_task"
  ) {
    if (pendingApproval) {
      lastApprovalOutcome = buildApprovalOutcome(pendingApproval, "expired", now);
    }
    pendingApproval = undefined;
    const taskId = createTaskId(input.conversationId, input.text);
    const runSessionId = createRunSessionId(taskId);
    const nextTask: TaskRecord = {
      id: taskId,
      kind: taskIntent.kind,
      status: "running",
      title: deriveTaskTitle({ kind: taskIntent.kind, text: input.text }),
      conversationId: input.conversationId,
      createdAt: latestTask?.id === taskId ? (latestTask.createdAt ?? now) : now,
      updatedAt: now,
      latestRunSessionId: runSessionId,
      latestRunSession: {
        id: runSessionId,
        status: resolveRunSessionStatusForTaskKind(taskIntent.kind),
        agentProfile: resolveAgentProfileForTaskKind(taskIntent.kind),
        updatedAt: now,
      },
    };
    latestTask = nextTask;
    recentTasks = upsertRecentTasks(recentTasks, nextTask);
  }

  if (
    controlAction?.type === "confirm_execution" &&
    snapshot.pendingApproval?.status === "pending" &&
    !pendingApprovalResolution &&
    pendingApproval?.status === "pending"
  ) {
    lastApprovalOutcome = buildApprovalOutcome(pendingApproval, "context_mismatch", now);
  }

  return {
    taskIntent,
    controlAction,
    rewrittenText,
    snapshot: {
      latestTask,
      recentTasks,
      pendingApproval,
      lastApprovalOutcome,
    },
    matchedExistingTask,
    pendingApprovalResolution,
  };
}

export function applyTaskRouterSnapshot(input: {
  entry: SessionEntry | undefined;
  snapshot: TaskRouterSnapshot;
}): SessionEntry {
  return withTaskRouterSnapshot(input.entry, input.snapshot);
}

export function updateTaskRouterPendingApproval(input: {
  entry: SessionEntry | undefined;
  pendingApproval?: TaskPendingApproval;
}): SessionEntry | undefined {
  if (!input.entry) {
    return undefined;
  }
  const snapshot = normalizeSnapshot(input.entry.taskRouter);
  const nextOutcome =
    snapshot.pendingApproval?.status === "resuming" && !input.pendingApproval
      ? buildApprovalOutcome(snapshot.pendingApproval, "consumed", Date.now())
      : snapshot.lastApprovalOutcome;
  return withTaskRouterSnapshot(input.entry, {
    ...snapshot,
    pendingApproval: input.pendingApproval,
    lastApprovalOutcome: nextOutcome,
  });
}

export function updateTaskRouterRunProgress(input: {
  entry: SessionEntry | undefined;
  taskId?: string;
  runSessionId?: string;
  runStatus:
    | "created"
    | "planning"
    | "researching"
    | "building"
    | "testing"
    | "reviewing"
    | "summarizing"
    | "paused"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  taskStatus?:
    | "new"
    | "planned"
    | "running"
    | "blocked"
    | "waiting_user"
    | "completed"
    | "failed"
    | "cancelled";
}): SessionEntry | undefined {
  if (!input.entry?.taskRouter || !input.taskId) {
    return input.entry;
  }

  const snapshot = normalizeSnapshot(input.entry.taskRouter);
  const now = Date.now();
  const updateTask = (task: TaskRecord): TaskRecord => {
    if (task.id !== input.taskId) {
      return task;
    }
    return updateTaskLatestRunSnapshot({
      task,
      runSessionId: input.runSessionId,
      runStatus: input.runStatus,
      taskStatus: input.taskStatus,
      now,
    });
  };

  const latestTask = snapshot.latestTask ? updateTask(snapshot.latestTask) : undefined;
  const recentTasks = snapshot.recentTasks?.map(updateTask) ?? [];
  const terminalClearedApproval = shouldClearApprovalForTask(snapshot.pendingApproval, latestTask)
    ? snapshot.pendingApproval
    : undefined;
  const cancelledResumingApproval =
    snapshot.pendingApproval?.status === "resuming" && input.runStatus === "cancelled"
      ? snapshot.pendingApproval
      : undefined;
  const nextPendingApproval = cancelledResumingApproval
    ? undefined
    : terminalClearedApproval
      ? undefined
      : snapshot.pendingApproval;
  const nextApprovalOutcome = cancelledResumingApproval
    ? buildApprovalOutcome(cancelledResumingApproval, "cancelled", now)
    : terminalClearedApproval
      ? buildApprovalOutcome(terminalClearedApproval, "terminal_cleared", now)
      : snapshot.lastApprovalOutcome;
  return withTaskRouterSnapshot(input.entry, {
    latestTask,
    recentTasks,
    pendingApproval: nextPendingApproval,
    lastApprovalOutcome: nextApprovalOutcome,
  });
}
