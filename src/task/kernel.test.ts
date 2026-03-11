import { describe, expect, it } from "vitest";
import { resolveExecutionKernelPlan } from "./kernel.js";
import type { TaskRouterDecision } from "./router.js";

function buildDecision(overrides: Partial<TaskRouterDecision>): TaskRouterDecision {
  return {
    taskIntent: {
      kind: "modify_code",
      text: "修复 router",
      conversationId: "telegram:1",
      requiresExecution: true,
    },
    controlAction: null,
    rewrittenText: "修复 router",
    matchedExistingTask: false,
    snapshot: {
      latestTask: {
        id: "task-1",
        kind: "modify_code",
        status: "running",
        title: "fix router",
        conversationId: "telegram:1",
        createdAt: 1,
        updatedAt: 2,
        latestRunSessionId: "run-1",
        latestRunSession: {
          id: "run-1",
          status: "building",
          agentProfile: "builder",
          updatedAt: 2,
        },
      },
      recentTasks: [],
    },
    ...overrides,
  };
}

describe("task/kernel", () => {
  it("builds a start_session execution kernel plan for new execution tasks", () => {
    const plan = resolveExecutionKernelPlan({
      decision: buildDecision({}),
      originalPrompt: "修复 router",
    });

    expect(plan.command).toMatchObject({
      type: "start_session",
      taskId: "task-1",
      conversationId: "telegram:1",
      runSessionId: "run-1",
      agentProfile: "builder",
    });
    expect(plan.events[0]).toMatchObject({
      type: "session_started",
      taskId: "task-1",
      runSessionId: "run-1",
      status: "building",
    });
    expect(plan.promptText).toContain("[Execution Kernel]");
    expect(plan.promptText).toContain("Command Type: start_session");
  });

  it("builds a resume_session plan for continue", () => {
    const plan = resolveExecutionKernelPlan({
      decision: buildDecision({
        controlAction: {
          type: "continue",
          conversationId: "telegram:1",
          taskId: "task-1",
          runSessionId: "run-1",
        },
        matchedExistingTask: true,
      }),
      originalPrompt: "[Task Router]\ncontinue task",
    });

    expect(plan.command?.type).toBe("resume_session");
    expect(plan.events[0]?.message).toContain("resume existing task run");
    expect(plan.promptText).toContain("Command Type: resume_session");
  });

  it("builds a request_summary plan for summary control", () => {
    const plan = resolveExecutionKernelPlan({
      decision: buildDecision({
        controlAction: {
          type: "request_summary",
          conversationId: "telegram:1",
          taskId: "task-1",
          runSessionId: "run-1",
        },
      }),
      originalPrompt: "[Task Router]\nsummary task",
    });

    expect(plan.command?.type).toBe("request_summary");
    expect(plan.events[0]).toMatchObject({
      type: "summary_ready",
      status: "building",
    });
  });

  it("returns no plan when there is no execution-bearing task", () => {
    const plan = resolveExecutionKernelPlan({
      decision: buildDecision({
        taskIntent: {
          kind: "cancel_task",
          text: "取消",
          conversationId: "telegram:1",
          requiresExecution: true,
        },
        snapshot: { recentTasks: [] },
      }),
      originalPrompt: "取消",
    });

    expect(plan.command).toBeUndefined();
    expect(plan.events).toEqual([]);
    expect(plan.promptText).toBeUndefined();
  });
});
