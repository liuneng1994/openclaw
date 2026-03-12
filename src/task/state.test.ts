import { describe, expect, it } from "vitest";
import {
  countActiveTasksForConversation,
  findLatestResumableTask,
  getLatestRunSessionId,
  getLatestRunSnapshot,
  updateTaskLatestRunSnapshot,
} from "./state.js";
import type { TaskRecord } from "./types.js";

describe("task/state", () => {
  const tasks: TaskRecord[] = [
    {
      id: "task-old",
      kind: "research_repo",
      status: "completed",
      title: "old",
      conversationId: "telegram:1",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "task-waiting",
      kind: "modify_code",
      status: "waiting_user",
      title: "waiting",
      conversationId: "telegram:1",
      createdAt: 3,
      updatedAt: 10,
    },
    {
      id: "task-running",
      kind: "research_repo",
      status: "running",
      title: "running",
      conversationId: "telegram:1",
      createdAt: 4,
      updatedAt: 8,
    },
  ];

  it("finds the latest resumable task for a conversation", () => {
    expect(findLatestResumableTask({ tasks, conversationId: "telegram:1" })?.id).toBe(
      "task-waiting",
    );
  });

  it("counts active tasks for a conversation", () => {
    expect(countActiveTasksForConversation({ tasks, conversationId: "telegram:1" })).toBe(2);
  });

  it("resolves latest run snapshot and id from a task", () => {
    const task: TaskRecord = {
      id: "task-run",
      kind: "modify_code",
      status: "running",
      title: "run",
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
    };

    expect(getLatestRunSessionId(task)).toBe("run-1");
    expect(getLatestRunSnapshot(task)).toMatchObject({
      id: "run-1",
      status: "building",
      agentProfile: "builder",
    });
  });

  it("updates task latest run snapshot through a shared helper", () => {
    const next = updateTaskLatestRunSnapshot({
      task: {
        id: "task-run",
        kind: "run_tests",
        status: "running",
        title: "run",
        conversationId: "telegram:1",
        createdAt: 1,
        updatedAt: 2,
      },
      runSessionId: "run-2",
      runStatus: "testing",
      taskStatus: "waiting_user",
      now: 10,
    });

    expect(next.status).toBe("waiting_user");
    expect(next.latestRunSessionId).toBe("run-2");
    expect(next.latestRunSession).toMatchObject({
      id: "run-2",
      status: "testing",
      agentProfile: "builder",
      updatedAt: 10,
    });
  });
});
