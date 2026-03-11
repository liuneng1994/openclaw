import type { TaskRecord } from "./types.js";
import { isActiveTaskStatus, isResumableTaskStatus } from "./types.js";

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
