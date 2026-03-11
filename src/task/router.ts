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

type TaskRouterSnapshot = {
  latestTask?: TaskRecord;
  recentTasks?: TaskRecord[];
};

export type TaskRouterDecision = {
  taskIntent: TaskIntent;
  controlAction: ControlAction | null;
  rewrittenText: string;
  snapshot: TaskRouterSnapshot;
  matchedExistingTask: boolean;
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
  };
}

function findLatestResumableTask(snapshot: TaskRouterSnapshot): TaskRecord | undefined {
  if (snapshot.latestTask && isResumableTaskStatus(snapshot.latestTask.status)) {
    return snapshot.latestTask;
  }
  return snapshot.recentTasks?.find((task) => isResumableTaskStatus(task.status));
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
  let rewrittenText = input.text;
  let matchedExistingTask = false;
  const resumableTask = findLatestResumableTask(snapshot);

  if (controlAction?.type === "continue" && resumableTask) {
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
    },
    matchedExistingTask,
  };
}

export function applyTaskRouterSnapshot(input: {
  entry: SessionEntry | undefined;
  snapshot: TaskRouterSnapshot;
}): SessionEntry {
  return withTaskRouterSnapshot(input.entry, input.snapshot);
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
  return withTaskRouterSnapshot(input.entry, { latestTask, recentTasks });
}
