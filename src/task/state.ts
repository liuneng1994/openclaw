import type { AgentProfileId, RunSessionStatus, TaskRecord, TaskRunSnapshot } from "./types.js";
import {
  isActiveTaskStatus,
  isResumableTaskStatus,
  resolveAgentProfileForTaskKind,
} from "./types.js";

export function sortTasksByUpdatedDesc(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].toSorted((a, b) => b.updatedAt - a.updatedAt);
}

export function findLatestTaskForConversation(params: {
  tasks: TaskRecord[];
  conversationId: string;
  statuses?: TaskRecord["status"][];
}): TaskRecord | undefined {
  const allowed = params.statuses ? new Set(params.statuses) : undefined;
  return sortTasksByUpdatedDesc(params.tasks).find(
    (task) =>
      task.conversationId === params.conversationId && (allowed ? allowed.has(task.status) : true),
  );
}

export function findLatestResumableTask(params: {
  tasks: TaskRecord[];
  conversationId: string;
}): TaskRecord | undefined {
  return sortTasksByUpdatedDesc(params.tasks).find(
    (task) => task.conversationId === params.conversationId && isResumableTaskStatus(task.status),
  );
}

export function countActiveTasksForConversation(params: {
  tasks: TaskRecord[];
  conversationId: string;
}): number {
  return params.tasks.filter(
    (task) => task.conversationId === params.conversationId && isActiveTaskStatus(task.status),
  ).length;
}

export function getLatestRunSnapshot(task: TaskRecord | undefined): TaskRunSnapshot | undefined {
  return task?.latestRunSession;
}

export function getLatestRunSessionId(task: TaskRecord | undefined): string | undefined {
  return task?.latestRunSessionId ?? task?.latestRunSession?.id;
}

export function updateTaskLatestRunSnapshot(params: {
  task: TaskRecord;
  runSessionId?: string;
  runStatus: RunSessionStatus;
  now?: number;
  taskStatus?: TaskRecord["status"];
  agentProfile?: AgentProfileId;
}): TaskRecord {
  const now = params.now ?? Date.now();
  const previousRun = getLatestRunSnapshot(params.task);
  return {
    ...params.task,
    status: params.taskStatus ?? params.task.status,
    updatedAt: now,
    latestRunSessionId: params.runSessionId ?? getLatestRunSessionId(params.task),
    latestRunSession: {
      id:
        params.runSessionId ?? previousRun?.id ?? params.task.latestRunSessionId ?? params.task.id,
      status: params.runStatus,
      agentProfile:
        params.agentProfile ??
        previousRun?.agentProfile ??
        resolveAgentProfileForTaskKind(params.task.kind),
      updatedAt: now,
    },
  };
}
