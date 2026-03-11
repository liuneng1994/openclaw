import { describe, expect, it } from "vitest";
import {
  createRootRunSession,
  DEFAULT_AGENT_PROFILES,
  deriveTaskTitle,
  isActiveTaskStatus,
  isResumableTaskStatus,
  resolveAgentProfileForTaskKind,
  resolveRunSessionStatusForTaskKind,
} from "./types.js";

describe("task/types", () => {
  it("marks active and resumable task statuses", () => {
    expect(isActiveTaskStatus("running")).toBe(true);
    expect(isActiveTaskStatus("completed")).toBe(false);
    expect(isResumableTaskStatus("waiting_user")).toBe(true);
    expect(isResumableTaskStatus("failed")).toBe(false);
  });

  it("derives short task titles", () => {
    expect(deriveTaskTitle({ kind: "research_repo", text: "  inspect repo architecture  " })).toBe(
      "inspect repo architecture",
    );
    expect(
      deriveTaskTitle({
        kind: "modify_code",
        text: "x".repeat(100),
      }),
    ).toHaveLength(80);
  });

  it("creates root run sessions with self root ids", () => {
    const session = createRootRunSession({
      id: "run-1",
      taskId: "task-1",
      now: 123,
      agentProfile: "planner",
    });

    expect(session).toMatchObject({
      id: "run-1",
      taskId: "task-1",
      rootRunSessionId: "run-1",
      status: "created",
      agentProfile: "planner",
      createdAt: 123,
      updatedAt: 123,
    });
  });

  it("maps task kinds to agent profiles and run phases", () => {
    expect(resolveAgentProfileForTaskKind("research_repo")).toBe("researcher");
    expect(resolveAgentProfileForTaskKind("modify_code")).toBe("builder");
    expect(resolveRunSessionStatusForTaskKind("run_tests")).toBe("testing");
    expect(resolveRunSessionStatusForTaskKind("review_diff")).toBe("reviewing");
  });

  it("ships the expected built-in agent profiles", () => {
    expect(DEFAULT_AGENT_PROFILES.planner.readOnly).toBe(true);
    expect(DEFAULT_AGENT_PROFILES.builder.readOnly).toBe(false);
    expect(DEFAULT_AGENT_PROFILES.planner.canSpawnChildren).toBe(true);
  });
});
