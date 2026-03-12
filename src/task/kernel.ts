import type { ExecToolDefaults } from "../agents/bash-tools.js";
import type { SandboxToolPolicy } from "../agents/sandbox/types.js";
import {
  createExecutionCommand,
  createExecutionEvent,
  type ExecutionCommand,
  type ExecutionEvent,
} from "./protocol.js";
import type { TaskRouterDecision } from "./router.js";
import { getLatestRunSessionId, getLatestRunSnapshot } from "./state.js";
import type { TaskRecord } from "./types.js";

export const EXECUTION_POLICY_MODES = ["readonly", "ask", "auto"] as const;
export type ExecutionPolicyMode = (typeof EXECUTION_POLICY_MODES)[number];

export const EXECUTION_POLICY_RISKS = ["low", "medium", "high"] as const;
export type ExecutionPolicyRisk = (typeof EXECUTION_POLICY_RISKS)[number];

export const EXECUTION_WRITE_INTENTS = ["none", "workspace", "git", "external"] as const;
export type ExecutionWriteIntent = (typeof EXECUTION_WRITE_INTENTS)[number];

export type ExecutionPolicy = {
  mode: ExecutionPolicyMode;
  risk: ExecutionPolicyRisk;
  writeIntent: ExecutionWriteIntent;
  requiresConfirmation: boolean;
};

type ExecutionKernelPlan = {
  command?: ExecutionCommand;
  events: ExecutionEvent[];
  policy?: ExecutionPolicy;
  promptText?: string;
  execOverrides?: Pick<ExecToolDefaults, "security" | "ask">;
};

function resolveExecutionPolicy(params: {
  decision: TaskRouterDecision;
  task?: TaskRecord;
}): ExecutionPolicy | undefined {
  const kind = params.task?.kind ?? params.decision.taskIntent.kind;
  const loweredText = params.decision.taskIntent.text.toLowerCase();

  if (params.decision.controlAction?.type === "downgrade_to_readonly") {
    return {
      mode: "readonly",
      risk: "low",
      writeIntent: "none",
      requiresConfirmation: false,
    };
  }

  if (params.decision.controlAction?.type === "confirm_execution") {
    const approvalKind = params.decision.pendingApprovalResolution?.approval.kind;
    return {
      mode: "ask",
      risk: "high",
      writeIntent:
        approvalKind === "git" || approvalKind === "external" ? approvalKind : "workspace",
      requiresConfirmation: false,
    };
  }

  if (kind === "research_repo" || kind === "review_diff" || kind === "ask") {
    return {
      mode: "readonly",
      risk: "low",
      writeIntent: "none",
      requiresConfirmation: false,
    };
  }

  if (kind === "run_tests") {
    return {
      mode: "auto",
      risk: "medium",
      writeIntent: "workspace",
      requiresConfirmation: false,
    };
  }

  if (kind === "modify_code") {
    const asksForGit = /\b(git commit|commit|git push|push|open pr|create pr|pull request)\b/i.test(
      loweredText,
    );
    const asksForExternal = /\b(send message|telegram|discord|slack|email|feishu)\b/i.test(
      loweredText,
    );

    if (asksForExternal) {
      return {
        mode: "ask",
        risk: "high",
        writeIntent: "external",
        requiresConfirmation: true,
      };
    }
    if (asksForGit) {
      return {
        mode: "ask",
        risk: "high",
        writeIntent: "git",
        requiresConfirmation: true,
      };
    }
    return {
      mode: "auto",
      risk: "medium",
      writeIntent: "workspace",
      requiresConfirmation: false,
    };
  }

  if (kind === "resume_task") {
    return {
      mode: "ask",
      risk: "medium",
      writeIntent: "workspace",
      requiresConfirmation: false,
    };
  }

  return undefined;
}

function resolvePolicyExecOverrides(
  policy: ExecutionPolicy | undefined,
): Pick<ExecToolDefaults, "security" | "ask"> | undefined {
  if (!policy) {
    return undefined;
  }
  if (policy.mode === "readonly") {
    return {
      security: "allowlist",
      ask: "always",
    };
  }
  if (policy.mode === "ask" || policy.requiresConfirmation) {
    return {
      ask: "always",
    };
  }
  return {
    ask: "on-miss",
  };
}

export function resolveExecutionPolicyToolPolicy(
  policy: ExecutionPolicy | undefined,
): SandboxToolPolicy | undefined {
  if (!policy || policy.mode !== "readonly") {
    return undefined;
  }

  return {
    deny: [
      "write",
      "edit",
      "apply_patch",
      "message",
      "sessions_send",
      "tts",
      "feishu_doc",
      "feishu_drive",
      "feishu_wiki",
      "feishu_bitable_create_app",
      "feishu_bitable_create_field",
      "feishu_bitable_create_record",
      "feishu_bitable_update_record",
    ],
  };
}

export function buildExecutionPolicySystemPrompt(policy: ExecutionPolicy): string {
  return [
    "[Execution Policy Guard]",
    `Mode: ${policy.mode}`,
    `Risk: ${policy.risk}`,
    `Write Intent: ${policy.writeIntent}`,
    `Requires Confirmation: ${policy.requiresConfirmation}`,
    "Policy Enforcement:",
    policy.mode === "readonly"
      ? "- Do not write files, mutate git state, send external messages, or run mutating shell commands. Restrict work to reading, inspection, explanation, and planning unless the user explicitly changes policy."
      : policy.mode === "ask"
        ? "- You may inspect and prepare changes, but before git mutations, external side effects, or risky writes, stop and ask for explicit confirmation."
        : "- Routine workspace edits and tests may proceed automatically within the workspace, but git mutations or external side effects still require confirmation when the policy says so.",
  ].join("\n");
}

function buildExecutionKernelPrompt(params: {
  command: ExecutionCommand;
  events: ExecutionEvent[];
  originalPrompt: string;
  task?: TaskRecord;
  policy?: ExecutionPolicy;
}): string {
  const commandLines = [
    `[Execution Kernel]`,
    `Command Type: ${params.command.type}`,
    `Task ID: ${params.command.taskId}`,
    `Conversation ID: ${params.command.conversationId}`,
    `Goal: ${params.command.goal}`,
    params.command.runSessionId ? `Run Session ID: ${params.command.runSessionId}` : undefined,
    params.command.parentRunSessionId
      ? `Parent Run Session ID: ${params.command.parentRunSessionId}`
      : undefined,
    params.command.agentProfile ? `Agent Profile: ${params.command.agentProfile}` : undefined,
    params.command.correlationId ? `Correlation ID: ${params.command.correlationId}` : undefined,
    params.task?.status ? `Task Status Snapshot: ${params.task.status}` : undefined,
    getLatestRunSnapshot(params.task)?.status
      ? `Run Status Snapshot: ${getLatestRunSnapshot(params.task)?.status}`
      : undefined,
    params.policy ? `Execution Policy Mode: ${params.policy.mode}` : undefined,
    params.policy ? `Execution Policy Risk: ${params.policy.risk}` : undefined,
    params.policy ? `Execution Write Intent: ${params.policy.writeIntent}` : undefined,
    params.policy
      ? `Execution Requires Confirmation: ${params.policy.requiresConfirmation}`
      : undefined,
    params.events.length > 0 ? `Execution Events:` : undefined,
    ...params.events.map(
      (event, index) =>
        `${index + 1}. ${event.type} (run=${event.runSessionId}, status=${event.status ?? "n/a"}, message=${event.message ?? ""})`,
    ),
    "Instruction: Treat the structured execution command above as the control-plane intent for this turn. Respect the execution policy: readonly means no writes or mutating commands; ask means require explicit confirmation before risky writes or external side effects; auto means routine workspace edits/tests may proceed within policy.",
    "",
    params.originalPrompt,
  ].filter(Boolean);

  return commandLines.join("\n");
}

function resolveExecutionCommandType(
  decision: TaskRouterDecision,
): ExecutionCommand["type"] | null {
  if (
    (decision.controlAction?.type === "continue" ||
      decision.controlAction?.type === "confirm_execution") &&
    decision.snapshot.latestTask
  ) {
    return "resume_session";
  }
  if (decision.controlAction?.type === "request_summary" && decision.snapshot.latestTask) {
    return "request_summary";
  }
  if (decision.controlAction?.type === "downgrade_to_readonly" && decision.snapshot.latestTask) {
    return "apply_permission_update";
  }
  if (
    decision.taskIntent.requiresExecution &&
    decision.taskIntent.kind !== "resume_task" &&
    decision.taskIntent.kind !== "cancel_task"
  ) {
    return "start_session";
  }
  return null;
}

export function resolveExecutionKernelPlan(input: {
  decision: TaskRouterDecision;
  originalPrompt: string;
}): ExecutionKernelPlan {
  const task = input.decision.snapshot.latestTask;
  const commandType = resolveExecutionCommandType(input.decision);
  if (!task || !commandType) {
    return { events: [] };
  }

  const goal = task.title || input.decision.taskIntent.text;
  const runSessionId = getLatestRunSessionId(task);
  const command = createExecutionCommand({
    type: commandType,
    taskId: task.id,
    conversationId: task.conversationId,
    goal,
    runSessionId,
    agentProfile: getLatestRunSnapshot(task)?.agentProfile,
    correlationId: `exec:${task.id}:${runSessionId ?? "pending"}`,
  });

  const events: ExecutionEvent[] = [];
  if (commandType === "start_session" || commandType === "resume_session") {
    events.push(
      createExecutionEvent({
        type: "session_started",
        taskId: task.id,
        runSessionId: runSessionId ?? task.id,
        conversationId: task.conversationId,
        status: getLatestRunSnapshot(task)?.status ?? "planning",
        correlationId: command.correlationId,
        message:
          commandType === "resume_session"
            ? "resume existing task run"
            : "start task run from control plane",
      }),
    );
  } else if (commandType === "request_summary") {
    events.push(
      createExecutionEvent({
        type: "summary_ready",
        taskId: task.id,
        runSessionId: runSessionId ?? task.id,
        conversationId: task.conversationId,
        status: getLatestRunSnapshot(task)?.status ?? "summarizing",
        correlationId: command.correlationId,
        message: "user requested a task summary",
      }),
    );
  } else if (commandType === "apply_permission_update") {
    events.push(
      createExecutionEvent({
        type: "permission_required",
        taskId: task.id,
        runSessionId: runSessionId ?? task.id,
        conversationId: task.conversationId,
        status: getLatestRunSnapshot(task)?.status,
        correlationId: command.correlationId,
        message: "downgrade task execution to readonly",
      }),
    );
  }

  const policy = resolveExecutionPolicy({
    decision: input.decision,
    task,
  });
  const execOverrides = resolvePolicyExecOverrides(policy);

  return {
    command,
    events,
    policy,
    execOverrides,
    promptText: buildExecutionKernelPrompt({
      command,
      events,
      originalPrompt: input.originalPrompt,
      task,
      policy,
    }),
  };
}
