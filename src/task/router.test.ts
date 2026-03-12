import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import {
  applyTaskRouterSnapshot,
  resolveTaskRouterDecision,
  updateTaskRouterPendingApproval,
  updateTaskRouterRunProgress,
} from "./router.js";

describe("task/router", () => {
  it("tracks a new execution task in the session snapshot", () => {
    const decision = resolveTaskRouterDecision({
      text: "研究这个 repo 的 session 架构",
      conversationId: "telegram:1",
    });

    expect(decision.snapshot.latestTask).toMatchObject({
      kind: "research_repo",
      status: "running",
      conversationId: "telegram:1",
    });
    expect(decision.snapshot.latestTask?.latestRunSession).toMatchObject({
      status: "researching",
      agentProfile: "researcher",
    });
    expect(decision.snapshot.recentTasks).toHaveLength(1);
    expect(decision.matchedExistingTask).toBe(false);
  });

  it("rewrites continue into a resume instruction when a latest task exists", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-1",
          kind: "modify_code",
          status: "waiting_user",
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
        recentTasks: [
          {
            id: "task-1",
            kind: "modify_code",
            status: "waiting_user",
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
        ],
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "继续",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.matchedExistingTask).toBe(true);
    expect(decision.rewrittenText).toContain("[Task Router]");
    expect(decision.rewrittenText).toContain("fix router");
    expect(decision.rewrittenText).toContain("Run Session Status");
    expect(decision.snapshot.latestTask?.status).toBe("running");
    expect(decision.snapshot.recentTasks?.[0]?.status).toBe("running");
  });

  it("marks the latest task as paused for 停一下", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
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
        recentTasks: [
          {
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
        ],
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "停一下",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("pause");
    expect(decision.snapshot.latestTask?.status).toBe("waiting_user");
    expect(decision.snapshot.recentTasks?.[0]?.status).toBe("waiting_user");
  });

  it("marks the latest task as cancelled for 取消", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
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
        recentTasks: [
          {
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
        ],
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "取消",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.taskIntent.kind).toBe("cancel_task");
    expect(decision.snapshot.latestTask?.status).toBe("cancelled");
    expect(decision.snapshot.recentTasks?.[0]?.status).toBe("cancelled");
  });

  it("builds a task-list prompt from tracked tasks", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-2",
          kind: "run_tests",
          status: "running",
          title: "run tests",
          conversationId: "telegram:1",
          createdAt: 2,
          updatedAt: 3,
        },
        recentTasks: [
          {
            id: "task-2",
            kind: "run_tests",
            status: "running",
            title: "run tests",
            conversationId: "telegram:1",
            createdAt: 2,
            updatedAt: 3,
          },
          {
            id: "task-1",
            kind: "modify_code",
            status: "waiting_user",
            title: "fix router",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "任务列表",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("list_tasks");
    expect(decision.rewrittenText).toContain("Tracked tasks:");
    expect(decision.rewrittenText).toContain("run tests");
    expect(decision.rewrittenText).toContain("fix router");
  });

  it("rewrites approval confirmation into a resume instruction when approval is pending", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-1",
          kind: "modify_code",
          status: "waiting_user",
          title: "fix router",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 2,
          latestRunSessionId: "run-1",
          latestRunSession: {
            id: "run-1",
            status: "paused",
            agentProfile: "builder",
            updatedAt: 2,
          },
        },
        recentTasks: [],
        pendingApproval: {
          kind: "git",
          status: "pending",
          taskId: "task-1",
          runSessionId: "run-1",
          summary: 'git commit -m "x"',
          createdAt: 3,
        },
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "确认执行",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("confirm_execution");
    expect(decision.matchedExistingTask).toBe(true);
    expect(decision.snapshot.pendingApproval).toMatchObject({
      kind: "git",
      status: "resuming",
      taskId: "task-1",
      runSessionId: "run-1",
    });
    expect(decision.snapshot.latestTask?.status).toBe("running");
    expect(decision.rewrittenText).toContain("previously blocked high-risk action");
    expect(decision.rewrittenText).toContain("Approval Kind: git");
  });

  it("falls back to the latest resumable task when approval run session drifted", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-1",
          kind: "modify_code",
          status: "waiting_user",
          title: "fix router",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 4,
          latestRunSessionId: "run-2",
          latestRunSession: {
            id: "run-2",
            status: "paused",
            agentProfile: "builder",
            updatedAt: 4,
          },
        },
        recentTasks: [],
        pendingApproval: {
          kind: "git",
          status: "pending",
          taskId: "task-1",
          runSessionId: "run-1",
          summary: 'git commit -m "x"',
          createdAt: 3,
        },
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "执行吧",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("confirm_execution");
    expect(decision.matchedExistingTask).toBe(true);
    expect(decision.pendingApprovalResolution?.resolution).toBe("fallback");
    expect(decision.snapshot.pendingApproval).toMatchObject({
      kind: "git",
      status: "resuming",
      taskId: "task-1",
      runSessionId: "run-1",
    });
    expect(decision.rewrittenText).toContain("Approval Resolution: fallback");
    expect(decision.rewrittenText).toContain("Resolved Run Session ID: run-2");
  });

  it("keeps pending approval when confirmation no longer matches a resumable task", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-2",
          kind: "modify_code",
          status: "waiting_user",
          title: "other task",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 4,
        },
        recentTasks: [],
        pendingApproval: {
          kind: "external",
          status: "pending",
          taskId: "task-1",
          runSessionId: "run-1",
          summary: "message send",
          createdAt: 3,
        },
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "确认执行",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("confirm_execution");
    expect(decision.matchedExistingTask).toBe(false);
    expect(decision.pendingApprovalResolution).toBeUndefined();
    expect(decision.snapshot.pendingApproval).toMatchObject({
      kind: "external",
      taskId: "task-1",
    });
    expect(decision.rewrittenText).toBe("确认执行");
  });

  it("does not reuse an approval already marked as resuming", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-1",
          kind: "modify_code",
          status: "waiting_user",
          title: "fix router",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 2,
        },
        recentTasks: [],
        pendingApproval: {
          kind: "git",
          status: "resuming",
          taskId: "task-1",
          runSessionId: "run-1",
          summary: 'git commit -m "x"',
          createdAt: 3,
          resumingAt: 4,
        },
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "确认执行",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("confirm_execution");
    expect(decision.matchedExistingTask).toBe(false);
    expect(decision.pendingApprovalResolution).toBeUndefined();
    expect(decision.snapshot.pendingApproval).toMatchObject({
      kind: "git",
      status: "resuming",
    });
  });

  it("clears pending approval on rejection", () => {
    const entry = updateTaskRouterPendingApproval({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "running",
            title: "fix router",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
          recentTasks: [],
        },
      },
      pendingApproval: {
        kind: "external",
        summary: "message send",
        createdAt: 3,
      },
    });

    const decision = resolveTaskRouterDecision({
      text: "先别执行",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.controlAction?.type).toBe("reject_execution");
    expect(decision.snapshot.pendingApproval).toBeUndefined();
    expect(decision.snapshot.latestTask?.status).toBe("waiting_user");
  });

  it("clears stale approval when a new execution-bearing task starts", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-1",
          kind: "modify_code",
          status: "waiting_user",
          title: "fix router",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 2,
        },
        recentTasks: [],
        pendingApproval: {
          kind: "git",
          status: "pending",
          taskId: "task-1",
          runSessionId: "run-1",
          summary: "git commit",
          createdAt: 3,
        },
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "run tests",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.snapshot.latestTask?.kind).toBe("run_tests");
    expect(decision.snapshot.pendingApproval).toBeUndefined();
  });

  it("falls back cleanly when continue has no matching task", () => {
    const decision = resolveTaskRouterDecision({
      text: "继续",
      conversationId: "telegram:1",
    });

    expect(decision.matchedExistingTask).toBe(false);
    expect(decision.rewrittenText).toBe("继续");
  });

  it("does not resume a cancelled latest task and falls back to the next resumable one", () => {
    const entry: SessionEntry = {
      sessionId: "session-1",
      updatedAt: 1,
      taskRouter: {
        latestTask: {
          id: "task-cancelled",
          kind: "modify_code",
          status: "cancelled",
          title: "cancelled task",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 3,
          latestRunSessionId: "run-cancelled",
          latestRunSession: {
            id: "run-cancelled",
            status: "cancelled",
            agentProfile: "builder",
            updatedAt: 3,
          },
        },
        recentTasks: [
          {
            id: "task-cancelled",
            kind: "modify_code",
            status: "cancelled",
            title: "cancelled task",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 3,
            latestRunSessionId: "run-cancelled",
            latestRunSession: {
              id: "run-cancelled",
              status: "cancelled",
              agentProfile: "builder",
              updatedAt: 3,
            },
          },
          {
            id: "task-waiting",
            kind: "run_tests",
            status: "waiting_user",
            title: "run tests",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
            latestRunSessionId: "run-waiting",
            latestRunSession: {
              id: "run-waiting",
              status: "paused",
              agentProfile: "builder",
              updatedAt: 2,
            },
          },
        ],
      },
    };

    const decision = resolveTaskRouterDecision({
      text: "继续",
      conversationId: "telegram:1",
      sessionEntry: entry,
    });

    expect(decision.matchedExistingTask).toBe(true);
    expect(decision.rewrittenText).toContain("Task ID: task-waiting");
    expect(decision.snapshot.latestTask?.id).toBe("task-waiting");
    expect(decision.snapshot.latestTask?.status).toBe("running");
  });

  it("persists task router snapshots onto session entries", () => {
    const next = applyTaskRouterSnapshot({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
      },
      snapshot: {
        latestTask: {
          id: "task-1",
          kind: "run_tests",
          status: "running",
          title: "run tests",
          conversationId: "telegram:1",
          createdAt: 1,
          updatedAt: 2,
        },
        recentTasks: [
          {
            id: "task-1",
            kind: "run_tests",
            status: "running",
            title: "run tests",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    });

    expect(next.taskRouter?.latestTask?.id).toBe("task-1");
    expect(next.taskRouter?.recentTasks?.[0]?.id).toBe("task-1");
  });

  it("clears approval when the bound task reaches a terminal status", () => {
    const next = updateTaskRouterRunProgress({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "run_tests",
            status: "running",
            title: "run tests",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
          recentTasks: [],
          pendingApproval: {
            kind: "git",
            status: "pending",
            taskId: "task-1",
            runSessionId: "run-1",
            summary: "git commit",
            createdAt: 3,
          },
        },
      },
      taskId: "task-1",
      runSessionId: "run-2",
      runStatus: "completed",
      taskStatus: "completed",
    });

    expect(next?.taskRouter?.pendingApproval).toBeUndefined();
  });

  it("clears resuming approval when the resumed run is cancelled", () => {
    const next = updateTaskRouterRunProgress({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "running",
            title: "fix router",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
          recentTasks: [],
          pendingApproval: {
            kind: "external",
            status: "resuming",
            taskId: "task-1",
            runSessionId: "run-1",
            summary: "message send",
            createdAt: 3,
            resumingAt: 4,
          },
        },
      },
      taskId: "task-1",
      runSessionId: "run-1",
      runStatus: "cancelled",
      taskStatus: "cancelled",
    });

    expect(next?.taskRouter?.pendingApproval).toBeUndefined();
  });

  it("clears stale resuming approval on ordinary continue control", () => {
    const decision = resolveTaskRouterDecision({
      text: "继续",
      conversationId: "telegram:1",
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "waiting_user",
            title: "fix router",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
            latestRunSessionId: "run-1",
            latestRunSession: {
              id: "run-1",
              status: "paused",
              agentProfile: "builder",
              updatedAt: 2,
            },
          },
          recentTasks: [],
          pendingApproval: {
            kind: "git",
            status: "resuming",
            taskId: "task-1",
            runSessionId: "run-1",
            summary: "git commit",
            createdAt: 3,
            resumingAt: 4,
          },
        },
      },
    });

    expect(decision.controlAction?.type).toBe("continue");
    expect(decision.snapshot.pendingApproval).toBeUndefined();
    expect(decision.snapshot.latestTask?.status).toBe("running");
  });

  it("clears stale resuming approval on summary control", () => {
    const decision = resolveTaskRouterDecision({
      text: "总结一下",
      conversationId: "telegram:1",
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "waiting_user",
            title: "fix router",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
            latestRunSessionId: "run-1",
            latestRunSession: {
              id: "run-1",
              status: "paused",
              agentProfile: "builder",
              updatedAt: 2,
            },
          },
          recentTasks: [],
          pendingApproval: {
            kind: "git",
            status: "resuming",
            taskId: "task-1",
            runSessionId: "run-1",
            summary: "git commit",
            createdAt: 3,
            resumingAt: 4,
          },
        },
      },
    });

    expect(decision.controlAction?.type).toBe("request_summary");
    expect(decision.snapshot.pendingApproval).toBeUndefined();
    expect(decision.rewrittenText).toContain("Summarize the current task state");
  });

  it("preserves pending approval while updating run progress", () => {
    const next = updateTaskRouterRunProgress({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "run_tests",
            status: "running",
            title: "run tests",
            conversationId: "telegram:1",
            createdAt: 1,
            updatedAt: 2,
          },
          recentTasks: [],
          pendingApproval: {
            kind: "git",
            status: "pending",
            taskId: "task-1",
            runSessionId: "run-1",
            summary: "git commit",
            createdAt: 3,
          },
        },
      },
      taskId: "task-1",
      runSessionId: "run-2",
      runStatus: "testing",
      taskStatus: "running",
    });

    expect(next?.taskRouter?.pendingApproval).toMatchObject({
      kind: "git",
      status: "pending",
      taskId: "task-1",
      runSessionId: "run-1",
    });
  });

  it("updates run progress for the tracked latest task", () => {
    const next = updateTaskRouterRunProgress({
      entry: {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
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
          recentTasks: [
            {
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
          ],
        },
      },
      taskId: "task-1",
      runSessionId: "run-1",
      runStatus: "completed",
      taskStatus: "waiting_user",
    });

    expect(next?.taskRouter?.latestTask?.status).toBe("waiting_user");
    expect(next?.taskRouter?.latestTask?.latestRunSession?.status).toBe("completed");
    expect(next?.taskRouter?.recentTasks?.[0]?.latestRunSession?.status).toBe("completed");
  });
});
