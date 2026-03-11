import type { SessionEntry } from "../config/sessions.js";
import { mergeSessionEntryPreserveActivity } from "../config/sessions.js";
import {
  inferControlAction,
  inferTaskIntent,
  type ControlAction,
  type TaskIntent,
} from "./protocol.js";
import { deriveTaskTitle, type TaskRecord } from "./types.js";

type TaskRouterSnapshot = {
  latestTask?: TaskRecord;
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

function buildResumePrompt(task: TaskRecord): string {
  return [
    "[Task Router]",
    "The user asked to continue the latest resumable task in this conversation.",
    `Task ID: ${task.id}`,
    `Task Title: ${task.title}`,
    `Task Kind: ${task.kind}`,
    `Task Status: ${task.status}`,
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
    "Instruction: Summarize the current task state, progress, blockers, and recommended next step.",
    "Original user message: 总结一下",
  ].join("\n");
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
  const existingTask = input.sessionEntry?.taskRouter?.latestTask;
  let latestTask = existingTask;
  let rewrittenText = input.text;
  let matchedExistingTask = false;

  if (controlAction?.type === "continue" && existingTask) {
    latestTask = {
      ...existingTask,
      status: "running",
      updatedAt: Date.now(),
    };
    rewrittenText = buildResumePrompt(latestTask);
    matchedExistingTask = true;
  } else if (controlAction?.type === "request_summary" && existingTask) {
    latestTask = {
      ...existingTask,
      updatedAt: Date.now(),
    };
    rewrittenText = buildSummaryPrompt(latestTask);
    matchedExistingTask = true;
  } else if (controlAction?.type === "pause" && existingTask) {
    latestTask = {
      ...existingTask,
      status: "waiting_user",
      updatedAt: Date.now(),
    };
  } else if (taskIntent.kind === "cancel_task" && existingTask) {
    latestTask = {
      ...existingTask,
      status: "cancelled",
      updatedAt: Date.now(),
    };
  } else if (
    taskIntent.requiresExecution &&
    taskIntent.kind !== "resume_task" &&
    taskIntent.kind !== "cancel_task"
  ) {
    latestTask = {
      id: createTaskId(input.conversationId, input.text),
      kind: taskIntent.kind,
      status: "running",
      title: deriveTaskTitle({ kind: taskIntent.kind, text: input.text }),
      conversationId: input.conversationId,
      createdAt:
        existingTask?.id === createTaskId(input.conversationId, input.text)
          ? (existingTask.createdAt ?? Date.now())
          : Date.now(),
      updatedAt: Date.now(),
      latestRunSessionId: undefined,
    };
  }

  return {
    taskIntent,
    controlAction,
    rewrittenText,
    snapshot: {
      latestTask,
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
