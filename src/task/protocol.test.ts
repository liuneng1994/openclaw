import { describe, expect, it } from "vitest";
import {
  createExecutionCommand,
  createExecutionEvent,
  inferControlAction,
  inferTaskIntent,
} from "./protocol.js";

describe("task/protocol", () => {
  it("infers resume intent from short chat commands", () => {
    expect(
      inferTaskIntent({
        text: "继续",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({
      kind: "resume_task",
      requiresExecution: true,
    });
  });

  it("infers repository research intent", () => {
    expect(
      inferTaskIntent({
        text: "研究这个 repo 的 session 架构",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({
      kind: "research_repo",
      requiresExecution: true,
    });
  });

  it("infers control actions for continue/pause/summary/task-list/readonly", () => {
    expect(
      inferControlAction({
        text: "继续",
        conversationId: "telegram:1",
        taskId: "task-1",
      }),
    ).toMatchObject({ type: "continue", taskId: "task-1" });

    expect(
      inferControlAction({
        text: "停一下",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({ type: "pause" });

    expect(
      inferControlAction({
        text: "总结一下",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({ type: "request_summary" });

    expect(
      inferControlAction({
        text: "任务列表",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({ type: "list_tasks" });

    expect(
      inferControlAction({
        text: "只分析",
        conversationId: "telegram:1",
      }),
    ).toMatchObject({ type: "downgrade_to_readonly" });
  });

  it("builds execution commands and events", () => {
    const command = createExecutionCommand({
      type: "start_session",
      taskId: "task-1",
      conversationId: "telegram:1",
      goal: "inspect repository structure",
      agentProfile: "planner",
      correlationId: "corr-1",
    });

    expect(command).toMatchObject({
      type: "start_session",
      taskId: "task-1",
      conversationId: "telegram:1",
      goal: "inspect repository structure",
      agentProfile: "planner",
      correlationId: "corr-1",
    });

    const event = createExecutionEvent({
      type: "session_started",
      taskId: "task-1",
      runSessionId: "run-1",
      conversationId: "telegram:1",
      status: "planning",
      message: "planner session started",
    });

    expect(event).toMatchObject({
      type: "session_started",
      taskId: "task-1",
      runSessionId: "run-1",
      conversationId: "telegram:1",
      status: "planning",
      message: "planner session started",
    });
  });
});
