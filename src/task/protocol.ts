import { Type, type Static } from "@sinclair/typebox";
import { optionalStringEnum, stringEnum } from "../agents/schema/typebox.js";
import {
  AGENT_PROFILE_IDS,
  RUN_SESSION_STATUSES,
  TASK_KINDS,
  TASK_STATUSES,
  type AgentProfileId,
  type RunSessionStatus,
  type TaskKind,
} from "./types.js";

export const CONTROL_ACTIONS = [
  "continue",
  "pause",
  "replan",
  "restrict_tools",
  "escalate_runtime",
  "downgrade_to_readonly",
  "inject_feedback",
  "request_summary",
  "list_tasks",
] as const;

export type ControlActionType = (typeof CONTROL_ACTIONS)[number];

export const EXECUTION_COMMANDS = [
  "start_session",
  "resume_session",
  "spawn_subsession",
  "pause_session",
  "cancel_session",
  "request_summary",
  "request_compaction",
  "apply_permission_update",
] as const;

export type ExecutionCommandType = (typeof EXECUTION_COMMANDS)[number];

export const EXECUTION_EVENTS = [
  "session_started",
  "subsession_started",
  "session_paused",
  "session_completed",
  "session_failed",
  "session_cancelled",
  "plan_generated",
  "tool_running",
  "tool_completed",
  "subtask_spawned",
  "summary_ready",
  "permission_required",
  "user_input_required",
  "conflict_detected",
  "test_failed",
  "loop_detected",
  "patch_ready",
  "diff_ready",
  "report_ready",
  "review_ready",
] as const;

export type ExecutionEventType = (typeof EXECUTION_EVENTS)[number];

export const TaskIntentSchema = Type.Object({
  kind: stringEnum(TASK_KINDS),
  text: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  taskId: Type.Optional(Type.String()),
  targetRepo: Type.Optional(Type.String()),
  requiresExecution: Type.Boolean(),
});

export type TaskIntent = Static<typeof TaskIntentSchema>;

export const ControlActionSchema = Type.Object({
  type: stringEnum(CONTROL_ACTIONS),
  conversationId: Type.String({ minLength: 1 }),
  taskId: Type.Optional(Type.String()),
  runSessionId: Type.Optional(Type.String()),
  feedback: Type.Optional(Type.String()),
});

export type ControlAction = Static<typeof ControlActionSchema>;

export const ExecutionCommandSchema = Type.Object({
  type: stringEnum(EXECUTION_COMMANDS),
  taskId: Type.String({ minLength: 1 }),
  runSessionId: Type.Optional(Type.String()),
  parentRunSessionId: Type.Optional(Type.String()),
  conversationId: Type.String({ minLength: 1 }),
  agentProfile: optionalStringEnum(AGENT_PROFILE_IDS),
  goal: Type.String({ minLength: 1 }),
  correlationId: Type.Optional(Type.String()),
});

export type ExecutionCommand = Static<typeof ExecutionCommandSchema>;

export const ExecutionEventSchema = Type.Object({
  type: stringEnum(EXECUTION_EVENTS),
  taskId: Type.String({ minLength: 1 }),
  runSessionId: Type.String({ minLength: 1 }),
  parentRunSessionId: Type.Optional(Type.String()),
  conversationId: Type.String({ minLength: 1 }),
  correlationId: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  status: Type.Optional(stringEnum(RUN_SESSION_STATUSES)),
});

export type ExecutionEvent = Static<typeof ExecutionEventSchema>;

const RESUME_PREFIXES = [/^继续[\s，,。.!！?？]*$/u, /^continue(?:\b|\s|$)/iu];
const PAUSE_PREFIXES = [/^停一下/u, /^暂停/u, /^pause(?:\b|\s|$)/iu];
const SUMMARY_PREFIXES = [/^总结一下/u, /^总结/u, /^summary(?:\b|\s|$)/iu];
const TASK_LIST_PREFIXES = [/^任务列表/u, /^列出任务/u, /^list tasks?(?:\b|\s|$)/iu];
const CANCEL_PREFIXES = [/^取消/u, /^停止任务/u, /^cancel(?:\b|\s|$)/iu];

export function inferTaskIntent(input: {
  text: string;
  conversationId: string;
  taskId?: string;
  targetRepo?: string;
}): TaskIntent {
  const text = input.text.trim();
  const lowered = text.toLowerCase();
  let kind: TaskKind = "ask";
  let requiresExecution = false;

  if (RESUME_PREFIXES.some((re) => re.test(text))) {
    kind = "resume_task";
    requiresExecution = true;
  } else if (CANCEL_PREFIXES.some((re) => re.test(text))) {
    kind = "cancel_task";
    requiresExecution = true;
  } else if (/\b(test|tests|测试|跑测试)\b/iu.test(lowered)) {
    kind = "run_tests";
    requiresExecution = true;
  } else if (/\b(review|审查|review一下)\b/iu.test(lowered)) {
    kind = "review_diff";
    requiresExecution = true;
  } else if (/\b(修改|实现|fix|修复|重构|改一下|实现一下)\b/iu.test(lowered)) {
    kind = "modify_code";
    requiresExecution = true;
  } else if (/\b(repo|仓库|代码库|架构|研究|分析)\b/iu.test(lowered)) {
    kind = "research_repo";
    requiresExecution = true;
  }

  return {
    kind,
    text,
    conversationId: input.conversationId,
    taskId: input.taskId,
    targetRepo: input.targetRepo,
    requiresExecution,
  };
}

export function inferControlAction(input: {
  text: string;
  conversationId: string;
  taskId?: string;
  runSessionId?: string;
}): ControlAction | null {
  const text = input.text.trim();
  const base = {
    conversationId: input.conversationId,
    taskId: input.taskId,
    runSessionId: input.runSessionId,
  };

  if (RESUME_PREFIXES.some((re) => re.test(text))) {
    return { type: "continue", ...base };
  }
  if (PAUSE_PREFIXES.some((re) => re.test(text))) {
    return { type: "pause", ...base };
  }
  if (SUMMARY_PREFIXES.some((re) => re.test(text))) {
    return { type: "request_summary", ...base };
  }
  if (TASK_LIST_PREFIXES.some((re) => re.test(text))) {
    return { type: "list_tasks", ...base };
  }
  if (text.startsWith("只分析") || /^readonly(?:\b|\s|$)/iu.test(text)) {
    return { type: "downgrade_to_readonly", ...base };
  }
  return null;
}

export function createExecutionCommand(input: {
  type: ExecutionCommandType;
  taskId: string;
  conversationId: string;
  goal: string;
  runSessionId?: string;
  parentRunSessionId?: string;
  agentProfile?: AgentProfileId;
  correlationId?: string;
}): ExecutionCommand {
  return {
    type: input.type,
    taskId: input.taskId,
    conversationId: input.conversationId,
    goal: input.goal,
    runSessionId: input.runSessionId,
    parentRunSessionId: input.parentRunSessionId,
    agentProfile: input.agentProfile,
    correlationId: input.correlationId,
  };
}

export function createExecutionEvent(input: {
  type: ExecutionEventType;
  taskId: string;
  runSessionId: string;
  conversationId: string;
  parentRunSessionId?: string;
  correlationId?: string;
  message?: string;
  status?: RunSessionStatus;
}): ExecutionEvent {
  return {
    type: input.type,
    taskId: input.taskId,
    runSessionId: input.runSessionId,
    conversationId: input.conversationId,
    parentRunSessionId: input.parentRunSessionId,
    correlationId: input.correlationId,
    message: input.message,
    status: input.status,
  };
}

export const TaskRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  kind: stringEnum(TASK_KINDS),
  status: stringEnum(TASK_STATUSES),
  title: Type.String({ minLength: 1 }),
  conversationId: Type.String({ minLength: 1 }),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  latestRunSessionId: Type.Optional(Type.String()),
});
