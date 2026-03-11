import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions.js";
import { applyTaskRouterSnapshot, resolveTaskRouterDecision } from "./router.js";

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
        },
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
    expect(decision.snapshot.latestTask?.status).toBe("running");
  });

  it("falls back cleanly when continue has no matching task", () => {
    const decision = resolveTaskRouterDecision({
      text: "继续",
      conversationId: "telegram:1",
    });

    expect(decision.matchedExistingTask).toBe(false);
    expect(decision.rewrittenText).toBe("继续");
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
      },
    });

    expect(next.taskRouter?.latestTask?.id).toBe("task-1");
  });
});
