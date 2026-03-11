export const TASK_STATUSES = [
  "new",
  "planned",
  "running",
  "blocked",
  "waiting_user",
  "completed",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_KINDS = [
  "ask",
  "research_repo",
  "modify_code",
  "run_tests",
  "review_diff",
  "resume_task",
  "cancel_task",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

export const RUN_SESSION_STATUSES = [
  "created",
  "planning",
  "researching",
  "building",
  "testing",
  "reviewing",
  "summarizing",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

export type RunSessionStatus = (typeof RUN_SESSION_STATUSES)[number];

export const AGENT_PROFILE_IDS = [
  "planner",
  "researcher",
  "builder",
  "reviewer",
  "summarizer",
  "utility",
] as const;

export type AgentProfileId = (typeof AGENT_PROFILE_IDS)[number];

export type ConversationRef = {
  conversationId: string;
  channel?: string;
  threadId?: string;
};

export type TaskRunSnapshot = {
  id: string;
  status: RunSessionStatus;
  agentProfile: AgentProfileId;
  updatedAt: number;
};

export type TaskRecord = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  conversationId: string;
  createdAt: number;
  updatedAt: number;
  latestRunSessionId?: string;
  latestRunSession?: TaskRunSnapshot;
};

export type RunSessionRecord = {
  id: string;
  taskId: string;
  status: RunSessionStatus;
  agentProfile: AgentProfileId;
  createdAt: number;
  updatedAt: number;
  parentRunSessionId?: string;
  rootRunSessionId: string;
  summary?: string;
};

export type AgentProfileRecord = {
  id: AgentProfileId;
  description: string;
  readOnly: boolean;
  canSpawnChildren: boolean;
  defaultStepBudget: number;
};

export const DEFAULT_AGENT_PROFILES: Record<AgentProfileId, AgentProfileRecord> = {
  planner: {
    id: "planner",
    description: "Produces plans and decides whether subtasks are needed.",
    readOnly: true,
    canSpawnChildren: true,
    defaultStepBudget: 12,
  },
  researcher: {
    id: "researcher",
    description: "Reads code and gathers repository facts.",
    readOnly: true,
    canSpawnChildren: false,
    defaultStepBudget: 24,
  },
  builder: {
    id: "builder",
    description: "Edits code and runs implementation-oriented commands.",
    readOnly: false,
    canSpawnChildren: false,
    defaultStepBudget: 32,
  },
  reviewer: {
    id: "reviewer",
    description: "Reviews changes and surfaces risks.",
    readOnly: true,
    canSpawnChildren: false,
    defaultStepBudget: 16,
  },
  summarizer: {
    id: "summarizer",
    description: "Summarizes execution into concise user-facing output.",
    readOnly: true,
    canSpawnChildren: false,
    defaultStepBudget: 8,
  },
  utility: {
    id: "utility",
    description: "Utility role for compaction, title generation, and maintenance.",
    readOnly: true,
    canSpawnChildren: false,
    defaultStepBudget: 8,
  },
};

const ACTIVE_TASK_STATUSES = new Set<TaskStatus>([
  "new",
  "planned",
  "running",
  "blocked",
  "waiting_user",
]);

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return ACTIVE_TASK_STATUSES.has(status);
}

const RESUMABLE_TASK_STATUSES = new Set<TaskStatus>([
  "blocked",
  "waiting_user",
  "running",
  "planned",
]);

export function isResumableTaskStatus(status: TaskStatus): boolean {
  return RESUMABLE_TASK_STATUSES.has(status);
}

export function deriveTaskTitle(input: { kind: TaskKind; text: string }): string {
  const text = input.text.trim().replace(/\s+/g, " ");
  if (!text) {
    return input.kind;
  }
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

export function resolveAgentProfileForTaskKind(kind: TaskKind): AgentProfileId {
  switch (kind) {
    case "research_repo":
      return "researcher";
    case "modify_code":
      return "builder";
    case "run_tests":
      return "builder";
    case "review_diff":
      return "reviewer";
    case "resume_task":
      return "planner";
    case "cancel_task":
      return "utility";
    case "ask":
    default:
      return "planner";
  }
}

export function resolveRunSessionStatusForTaskKind(kind: TaskKind): RunSessionStatus {
  switch (kind) {
    case "research_repo":
      return "researching";
    case "modify_code":
      return "building";
    case "run_tests":
      return "testing";
    case "review_diff":
      return "reviewing";
    case "resume_task":
      return "planning";
    case "cancel_task":
      return "cancelled";
    case "ask":
    default:
      return "planning";
  }
}

export function createRootRunSession(params: {
  id: string;
  taskId: string;
  now?: number;
  agentProfile: AgentProfileId;
}): RunSessionRecord {
  const now = params.now ?? Date.now();
  return {
    id: params.id,
    taskId: params.taskId,
    status: "created",
    agentProfile: params.agentProfile,
    createdAt: now,
    updatedAt: now,
    rootRunSessionId: params.id,
  };
}
