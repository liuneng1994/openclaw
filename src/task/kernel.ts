import {
  createExecutionCommand,
  createExecutionEvent,
  type ExecutionCommand,
  type ExecutionEvent,
} from "./protocol.js";
import type { TaskRouterDecision } from "./router.js";
import type { TaskRecord } from "./types.js";

type ExecutionKernelPlan = {
  command?: ExecutionCommand;
  events: ExecutionEvent[];
  promptText?: string;
};

function buildExecutionKernelPrompt(params: {
  command: ExecutionCommand;
  events: ExecutionEvent[];
  originalPrompt: string;
  task?: TaskRecord;
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
    params.task?.latestRunSession?.status
      ? `Run Status Snapshot: ${params.task.latestRunSession.status}`
      : undefined,
    params.events.length > 0 ? `Execution Events:` : undefined,
    ...params.events.map(
      (event, index) =>
        `${index + 1}. ${event.type} (run=${event.runSessionId}, status=${event.status ?? "n/a"}, message=${event.message ?? ""})`,
    ),
    "Instruction: Treat the structured execution command above as the control-plane intent for this turn. Use it to continue the current task instead of interpreting the message as an unrelated fresh request.",
    "",
    params.originalPrompt,
  ].filter(Boolean);

  return commandLines.join("\n");
}

function resolveExecutionCommandType(
  decision: TaskRouterDecision,
): ExecutionCommand["type"] | null {
  if (decision.controlAction?.type === "continue" && decision.snapshot.latestTask) {
    return "resume_session";
  }
  if (decision.controlAction?.type === "request_summary" && decision.snapshot.latestTask) {
    return "request_summary";
  }
  if (
    decision.taskIntent.requiresExecution &&
    decision.taskIntent.kind !== "resume_task" &&
    decision.taskIntent.kind !== "cancel_task"
  ) {
    return "start_session";
  }
  if (decision.controlAction?.type === "downgrade_to_readonly" && decision.snapshot.latestTask) {
    return "apply_permission_update";
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
  const runSessionId = task.latestRunSessionId ?? task.latestRunSession?.id;
  const command = createExecutionCommand({
    type: commandType,
    taskId: task.id,
    conversationId: task.conversationId,
    goal,
    runSessionId,
    agentProfile: task.latestRunSession?.agentProfile,
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
        status: task.latestRunSession?.status ?? "planning",
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
        status: task.latestRunSession?.status ?? "summarizing",
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
        status: task.latestRunSession?.status,
        correlationId: command.correlationId,
        message: "downgrade task execution to readonly",
      }),
    );
  }

  return {
    command,
    events,
    promptText: buildExecutionKernelPrompt({
      command,
      events,
      originalPrompt: input.originalPrompt,
      task,
    }),
  };
}
