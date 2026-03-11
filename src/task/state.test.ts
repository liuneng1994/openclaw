import { describe, expect, it } from "vitest";
import { countActiveTasksForConversation, findLatestResumableTask } from "./state.js";
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
});
