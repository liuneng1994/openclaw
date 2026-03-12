import type { SessionEntry } from "../config/sessions.js";
import { mergeSessionEntryPreserveActivity } from "../config/sessions.js";
import {
  inferControlAction,
  inferTaskIntent,
  type ControlAction,
  type TaskIntent,
} from "./protocol.js";
import {
  deriveTaskTitle,
  isResumableTaskStatus,
  resolveAgentProfileForTaskKind,
  resolveRunSessionStatusForTaskKind,
  type TaskRecord,
} from "./types.js";

const MAX_RECENT_TASKS = 5;

export type TaskPendingApproval = {
  kind: "git" | "external";
  status: "pending" | "resuming";
  taskId?: string;
  runSessionId?: string;
  summary: string;
  createdAt: number;
  resumingAt?: number;
};

export type TaskRouterSnapshot = {
  latestTask?: TaskRecord;
  recentTasks?: TaskRecord[];
  pendingApproval?: TaskPendingApproval;
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
  if (!task.latestRunSession) {
    return [];
  }
  return [
    `Run Session ID: ${task.latestRunSession.id}`,
    `Run Session Status: ${task.latestRunSession.status}`,
    `Run Agent Profile: ${task.latestRunSession.agentProfile}`,
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

function buildSummaryPrompt(task: TaskRecord): string {
  return [
    "[Task Router]",
    "The user asked for a summary of the latest active/resumable task in this conversation.",
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Task Kind: ${task.kind}`,
    `Task Status: ${task.status}`,
    ...buildRunSnapshotLines(task),
    "Instruction: Summarize the current task state, progress, blockers, and recommended next step.",
    "Original user message: 总结一下",
  ].join("\n");
}

function buildTaskListPrompt(tasks: TaskRecord[]): string {
  const lines = tasks.map(
    (task, index) =>
      `${index + 1}. [${task.status}] ${task.title} (id=${task.id}, kind=${task.kind})`,
  );
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
    task.latestRunSession?.id ? `Resolved Run Session ID: ${task.latestRunSession.id}` : undefined,
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
  return (
    task.latestRunSessionId === approval.runSessionId ||
    task.latestRunSession?.id === approval.runSessionId
  );
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
  let latestTask = snapshot.latestTask;
  let recentTasks = snapshot.recentTasks ?? [];
  let pendingApproval = snapshot.pendingApproval;
  let rewrittenText = input.text;
  let matchedExistingTask = false;
  let pendingApprovalResolution: PendingApprovalResolution | undefined;
  const resumableTask = findLatestResumableTask(snapshot);

  if (controlAction?.type === "confirm_execution" && pendingApproval) {
    pendingApprovalResolution = resolvePendingApprovalTask(snapshot, pendingApproval);
    if (pendingApprovalResolution) {
      latestTask = {
        ...pendingApprovalResolution.task,
        status: "running",
        updatedAt: Date.now(),
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
        resumingAt: Date.now(),
      };
      matchedExistingTask = true;
    }
  } else if (controlAction?.type === "reject_execution" && pendingApproval && latestTask) {
    latestTask = {
      ...latestTask,
      status: "waiting_user",
      updatedAt: Date.now(),
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    pendingApproval = undefined;
    matchedExistingTask = true;
  } else if (controlAction?.type === "continue" && resumableTask) {
    latestTask = {
      ...resumableTask,
      status: "running",
      updatedAt: Date.now(),
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    rewrittenText = buildResumePrompt(latestTask);
    matchedExistingTask = true;
  } else if (controlAction?.type === "request_summary" && resumableTask) {
    latestTask = {
      ...resumableTask,
      updatedAt: Date.now(),
    };
    recentTasks = upsertRecentTasks(recentTasks, latestTask);
    rewrittenText = buildSummaryPrompt(latestTask);
    matchedExistingTask = true;
  } else if (controlAction?.type === "list_tasks") {
    rewrittenText = buildTaskListPrompt(recentTasks);
    matchedExistingTask = recentTasks.length > 0;
  } else if (controlAction?.type === "pause" && latestTask) {
    latestTask = {
      ...latestTask,
      status: "waiting_user",
      updatedAt: Date.now(),
    };
    recentTasks = updateExistingTaskStatus(recentTasks, latestTask.id, () => latestTask!);
  } else if (taskIntent.kind === "cancel_task" && latestTask) {
    latestTask = {
      ...latestTask,
      status: "cancelled",
      updatedAt: Date.now(),
    };
    recentTasks = updateExistingTaskStatus(recentTasks, latestTask.id, () => latestTask!);
  } else if (
    taskIntent.requiresExecution &&
    taskIntent.kind !== "resume_task" &&
    taskIntent.kind !== "cancel_task"
  ) {
    pendingApproval = undefined;
    const taskId = createTaskId(input.conversationId, input.text);
    const runSessionId = createRunSessionId(taskId);
    const now = Date.now();
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

  return {
    taskIntent,
    controlAction,
    rewrittenText,
    snapshot: {
      latestTask,
      recentTasks,
      pendingApproval,
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
  return withTaskRouterSnapshot(input.entry, {
    ...normalizeSnapshot(input.entry.taskRouter),
    pendingApproval: input.pendingApproval,
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
    return {
      ...task,
      status: input.taskStatus ?? task.status,
      updatedAt: now,
      latestRunSessionId: input.runSessionId ?? task.latestRunSessionId,
      latestRunSession: {
        id: input.runSessionId ?? task.latestRunSession?.id ?? task.latestRunSessionId ?? task.id,
        status: input.runStatus,
        agentProfile:
          task.latestRunSession?.agentProfile ?? resolveAgentProfileForTaskKind(task.kind),
        updatedAt: now,
      },
    };
  };

  const latestTask = snapshot.latestTask ? updateTask(snapshot.latestTask) : undefined;
  const recentTasks = snapshot.recentTasks?.map(updateTask) ?? [];
  return withTaskRouterSnapshot(input.entry, {
    latestTask,
    recentTasks,
    pendingApproval: snapshot.pendingApproval,
  });
}
