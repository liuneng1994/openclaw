import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPreparedReply } from "./get-reply-run.js";

vi.mock("../../agents/auth-profiles/session-override.js", () => ({
  resolveSessionAuthProfileOverride: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: vi.fn().mockReturnValue("session:session-key"),
}));

vi.mock("../../config/sessions.js", () => ({
  mergeSessionEntryPreserveActivity: vi.fn().mockImplementation((entry, patch) => ({
    ...entry,
    ...patch,
  })),
  resolveGroupSessionKey: vi.fn().mockReturnValue(undefined),
  resolveSessionFilePath: vi.fn().mockReturnValue("/tmp/session.jsonl"),
  resolveSessionFilePathOptions: vi.fn().mockReturnValue({}),
  updateSessionStore: vi.fn(),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

vi.mock("../../process/command-queue.js", () => ({
  clearCommandLane: vi.fn().mockReturnValue(0),
  getQueueSize: vi.fn().mockReturnValue(0),
}));

vi.mock("../../routing/session-key.js", () => ({
  normalizeMainKey: vi.fn().mockReturnValue("main"),
}));

vi.mock("../../utils/provider-utils.js", () => ({
  isReasoningTagProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("../command-detection.js", () => ({
  hasControlCommand: vi.fn().mockReturnValue(false),
}));

vi.mock("./agent-runner.js", () => ({
  runReplyAgent: vi.fn().mockResolvedValue({ text: "ok" }),
}));

vi.mock("./body.js", () => ({
  applySessionHints: vi.fn().mockImplementation(async ({ baseBody }) => baseBody),
}));

vi.mock("./groups.js", () => ({
  buildGroupIntro: vi.fn().mockReturnValue(""),
  buildGroupChatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("./inbound-meta.js", () => ({
  buildInboundMetaSystemPrompt: vi.fn().mockReturnValue(""),
  buildInboundUserContextPrefix: vi.fn().mockReturnValue(""),
}));

vi.mock("./queue.js", () => ({
  resolveQueueSettings: vi.fn().mockReturnValue({ mode: "followup" }),
}));

vi.mock("./route-reply.js", () => ({
  routeReply: vi.fn(),
}));

vi.mock("./session-updates.js", () => ({
  ensureSkillSnapshot: vi.fn().mockImplementation(async ({ sessionEntry, systemSent }) => ({
    sessionEntry,
    systemSent,
    skillsSnapshot: undefined,
  })),
  drainFormattedSystemEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./typing-mode.js", () => ({
  resolveTypingMode: vi.fn().mockReturnValue("off"),
}));

import { abortEmbeddedPiRun, isEmbeddedPiRunActive } from "../../agents/pi-embedded.js";
import { updateSessionStore } from "../../config/sessions.js";
import { clearCommandLane } from "../../process/command-queue.js";
import { runReplyAgent } from "./agent-runner.js";
import { routeReply } from "./route-reply.js";
import { drainFormattedSystemEvents } from "./session-updates.js";
import { resolveTypingMode } from "./typing-mode.js";

function baseParams(
  overrides: Partial<Parameters<typeof runPreparedReply>[0]> = {},
): Parameters<typeof runPreparedReply>[0] {
  return {
    ctx: {
      Body: "",
      RawBody: "",
      CommandBody: "",
      ThreadHistoryBody: "Earlier message in this thread",
      OriginatingChannel: "slack",
      OriginatingTo: "C123",
      ChatType: "group",
    },
    sessionCtx: {
      Body: "",
      BodyStripped: "",
      ThreadHistoryBody: "Earlier message in this thread",
      MediaPath: "/tmp/input.png",
      Provider: "slack",
      ChatType: "group",
      OriginatingChannel: "slack",
      OriginatingTo: "C123",
    },
    cfg: { session: {}, channels: {}, agents: { defaults: {} } },
    agentId: "default",
    agentDir: "/tmp/agent",
    agentCfg: {},
    sessionCfg: {},
    commandAuthorized: true,
    command: {
      isAuthorizedSender: true,
      abortKey: "session-key",
      ownerList: [],
      senderIsOwner: false,
    } as never,
    commandSource: "",
    allowTextCommands: true,
    directives: {
      hasThinkDirective: false,
      thinkLevel: undefined,
    } as never,
    defaultActivation: "always",
    resolvedThinkLevel: "high",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    elevatedEnabled: false,
    elevatedAllowed: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    modelState: {
      resolveDefaultThinkingLevel: async () => "medium",
    } as never,
    provider: "anthropic",
    model: "claude-opus-4-1",
    typing: {
      onReplyStart: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn(),
    } as never,
    defaultProvider: "anthropic",
    defaultModel: "claude-opus-4-1",
    timeoutMs: 30_000,
    isNewSession: true,
    resetTriggered: false,
    systemSent: true,
    sessionKey: "session-key",
    workspaceDir: "/tmp/workspace",
    abortedLastRun: false,
    ...overrides,
  };
}

describe("runPreparedReply media-only handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(abortEmbeddedPiRun).mockReturnValue(false);
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(false);
    vi.mocked(clearCommandLane).mockReturnValue(0);
  });

  it("injects execution kernel metadata for new execution tasks", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "fix router",
          RawBody: "fix router",
          CommandBody: "fix router",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: "slack",
          OriginatingTo: "C123",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "fix router",
          BodyStripped: "fix router",
          ThreadHistoryBody: "Earlier message in this thread",
          Provider: "slack",
          ChatType: "group",
          OriginatingChannel: "slack",
          OriginatingTo: "C123",
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.commandBody).toContain("[Execution Kernel]");
    expect(call?.commandBody).toContain("Command Type: start_session");
    expect(call?.commandBody).toContain("Task ID:");
    expect(call?.commandBody).toContain("Execution Policy Mode: auto");
    expect(call?.followupRun.prompt).toContain("[Execution Kernel]");
    expect(call?.followupRun.run.execOverrides).toMatchObject({ ask: "on-miss" });
  });

  it("forces readonly execution posture for readonly control", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "readonly",
          RawBody: "readonly",
          CommandBody: "readonly",
          ThreadHistoryBody: "",
          OriginatingChannel: "slack",
          OriginatingTo: "C123",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "readonly",
          BodyStripped: "readonly",
          ThreadHistoryBody: "",
          Provider: "slack",
          ChatType: "group",
          OriginatingChannel: "slack",
          OriginatingTo: "C123",
        },
        sessionEntry: {
          taskRouter: {
            latestTask: {
              id: "task-1",
              kind: "modify_code",
              status: "running",
              title: "fix router",
              conversationId: "session-key",
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
        } as never,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.commandBody).toContain("Command Type: apply_permission_update");
    expect(call?.commandBody).toContain("Execution Policy Mode: readonly");
    expect(call?.followupRun.run.execOverrides).toMatchObject({
      ask: "always",
      security: "allowlist",
    });
  });

  it("allows media-only prompts and preserves thread context in queued followups", async () => {
    const result = await runPreparedReply(baseParams());
    expect(result).toEqual({ text: "ok" });

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).toContain("[Thread history - for context]");
    expect(call?.followupRun.prompt).toContain("Earlier message in this thread");
    expect(call?.followupRun.prompt).toContain("[User sent media without caption]");
  });

  it("keeps thread history context on follow-up turns", async () => {
    const result = await runPreparedReply(
      baseParams({
        isNewSession: false,
      }),
    );
    expect(result).toEqual({ text: "ok" });

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).toContain("[Thread history - for context]");
    expect(call?.followupRun.prompt).toContain("Earlier message in this thread");
  });

  it("returns the empty-body reply when there is no text and no media", async () => {
    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          Provider: "slack",
        },
      }),
    );

    expect(result).toEqual({
      text: "I didn't receive any text in your message. Please resend or add a caption.",
    });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
  });

  it("omits auth key labels from /new and /reset confirmation messages", async () => {
    await runPreparedReply(
      baseParams({
        resetTriggered: true,
      }),
    );

    const resetNoticeCall = vi.mocked(routeReply).mock.calls[0]?.[0] as
      | { payload?: { text?: string } }
      | undefined;
    expect(resetNoticeCall?.payload?.text).toContain("✅ New session started · model:");
    expect(resetNoticeCall?.payload?.text).not.toContain("🔑");
    expect(resetNoticeCall?.payload?.text).not.toContain("api-key");
    expect(resetNoticeCall?.payload?.text).not.toContain("env:");
  });

  it("skips reset notice when only webchat fallback routing is available", async () => {
    await runPreparedReply(
      baseParams({
        resetTriggered: true,
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
          ChatType: "group",
        },
        command: {
          isAuthorizedSender: true,
          abortKey: "session-key",
          ownerList: [],
          senderIsOwner: false,
          channel: "webchat",
          from: undefined,
          to: undefined,
        } as never,
      }),
    );

    expect(vi.mocked(routeReply)).not.toHaveBeenCalled();
  });

  it("does not start a duplicate run when 继续 targets an already active embedded run", async () => {
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    const sessionStore = {
      "session-key": {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "waiting_user",
            title: "fix router",
            conversationId: "session-key",
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
              conversationId: "session-key",
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
        abortedLastRun: false,
      },
    } as never;

    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "继续",
          RawBody: "继续",
          CommandBody: "继续",
        },
        sessionCtx: {
          Body: "继续",
          BodyStripped: "继续",
          Provider: "slack",
        },
        sessionEntry: sessionStore["session-key"],
        sessionStore,
        storePath: "/tmp/session-store.json",
        isNewSession: false,
      }),
    );

    expect(result).toEqual({
      text: "当前任务仍在推进中，Master：fix router。我不会重复新开一轮执行；若您要我汇报现状，可以直接发“总结一下”。",
    });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
  });

  it("acknowledges pause without starting a new agent run", async () => {
    const sessionStore = {
      "session-key": {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "running",
            title: "fix router",
            conversationId: "session-key",
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
              conversationId: "session-key",
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
        abortedLastRun: false,
      },
    } as never;

    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "停一下",
          RawBody: "停一下",
          CommandBody: "停一下",
        },
        sessionCtx: {
          Body: "停一下",
          BodyStripped: "停一下",
          Provider: "slack",
        },
        sessionEntry: sessionStore["session-key"],
        sessionStore,
        storePath: "/tmp/session-store.json",
        isNewSession: false,
      }),
    );

    expect(result).toEqual({
      text: "已先停在这里，Master。任务已标记为暂停待命：fix router；您稍后发“继续”即可从最近上下文接着推进。",
    });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
    expect(sessionStore["session-key"].taskRouter.latestTask.status).toBe("waiting_user");
    expect(sessionStore["session-key"].taskRouter.latestTask.latestRunSession.status).toBe(
      "paused",
    );
    expect(sessionStore["session-key"].abortedLastRun).toBe(false);
  });

  it("cancels the current task and records abortedLastRun", async () => {
    vi.mocked(isEmbeddedPiRunActive).mockReturnValue(true);
    vi.mocked(abortEmbeddedPiRun).mockReturnValue(true);
    const sessionStore = {
      "session-key": {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "running",
            title: "fix router",
            conversationId: "session-key",
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
              conversationId: "session-key",
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
        abortedLastRun: false,
      },
    } as never;

    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "取消",
          RawBody: "取消",
          CommandBody: "取消",
        },
        sessionCtx: {
          Body: "取消",
          BodyStripped: "取消",
          Provider: "slack",
        },
        sessionEntry: sessionStore["session-key"],
        sessionStore,
        storePath: "/tmp/session-store.json",
        isNewSession: false,
      }),
    );

    expect(result).toEqual({
      text: "已执行取消，Master。当前任务已标记为取消，并已尝试中断正在进行的运行：fix router。",
    });
    expect(vi.mocked(runReplyAgent)).not.toHaveBeenCalled();
    expect(vi.mocked(abortEmbeddedPiRun)).toHaveBeenCalledWith("session-1");
    expect(vi.mocked(clearCommandLane)).toHaveBeenCalled();
    expect(sessionStore["session-key"].taskRouter.latestTask.status).toBe("cancelled");
    expect(sessionStore["session-key"].taskRouter.latestTask.latestRunSession.status).toBe(
      "cancelled",
    );
    expect(sessionStore["session-key"].abortedLastRun).toBe(true);
    expect(vi.mocked(updateSessionStore)).toHaveBeenCalled();
  });

  it("falls back to snapshot-only cancel when no embedded run is active", async () => {
    const sessionStore = {
      "session-key": {
        sessionId: "session-1",
        updatedAt: 1,
        taskRouter: {
          latestTask: {
            id: "task-1",
            kind: "modify_code",
            status: "running",
            title: "fix router",
            conversationId: "session-key",
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
              conversationId: "session-key",
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
        abortedLastRun: false,
      },
    } as never;

    const result = await runPreparedReply(
      baseParams({
        ctx: {
          Body: "取消",
          RawBody: "取消",
          CommandBody: "取消",
        },
        sessionCtx: {
          Body: "取消",
          BodyStripped: "取消",
          Provider: "slack",
        },
        sessionEntry: sessionStore["session-key"],
        sessionStore,
        storePath: "/tmp/session-store.json",
        isNewSession: false,
      }),
    );

    expect(result).toEqual({
      text: "已执行取消，Master。当前任务已标记为取消：fix router；此刻没有发现可中断的活动运行。",
    });
    expect(vi.mocked(abortEmbeddedPiRun)).not.toHaveBeenCalled();
    expect(vi.mocked(clearCommandLane)).not.toHaveBeenCalled();
    expect(sessionStore["session-key"].taskRouter.latestTask.status).toBe("cancelled");
    expect(sessionStore["session-key"].abortedLastRun).toBe(false);
  });

  it("uses inbound origin channel for run messageProvider", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: "webchat",
          OriginatingTo: "session:abc",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          ThreadHistoryBody: "Earlier message in this thread",
          MediaPath: "/tmp/input.png",
          Provider: "telegram",
          ChatType: "group",
          OriginatingChannel: "telegram",
          OriginatingTo: "telegram:123",
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.messageProvider).toBe("webchat");
  });

  it("prefers Provider over Surface when origin channel is missing", async () => {
    await runPreparedReply(
      baseParams({
        ctx: {
          Body: "",
          RawBody: "",
          CommandBody: "",
          ThreadHistoryBody: "Earlier message in this thread",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
          Provider: "feishu",
          Surface: "webchat",
          ChatType: "group",
        },
        sessionCtx: {
          Body: "",
          BodyStripped: "",
          ThreadHistoryBody: "Earlier message in this thread",
          MediaPath: "/tmp/input.png",
          Provider: "webchat",
          ChatType: "group",
          OriginatingChannel: undefined,
          OriginatingTo: undefined,
        },
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call?.followupRun.run.messageProvider).toBe("feishu");
  });

  it("passes suppressTyping through typing mode resolution", async () => {
    await runPreparedReply(
      baseParams({
        opts: {
          suppressTyping: true,
        },
      }),
    );

    const call = vi.mocked(resolveTypingMode).mock.calls[0]?.[0] as
      | { suppressTyping?: boolean }
      | undefined;
    expect(call?.suppressTyping).toBe(true);
  });

  it("routes queued system events into user prompt text, not system prompt context", async () => {
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Model switched.");

    await runPreparedReply(baseParams());

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.commandBody).toContain("System: [t] Model switched.");
    expect(call?.followupRun.run.extraSystemPrompt ?? "").not.toContain("Runtime System Events");
  });

  it("preserves first-token think hint when system events are prepended", async () => {
    // drainFormattedSystemEvents returns just the events block; the caller prepends it.
    // The hint must be extracted from the user body BEFORE prepending, so "System:"
    // does not shadow the low|medium|high shorthand.
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Node connected.");

    await runPreparedReply(
      baseParams({
        ctx: { Body: "low tell me about cats", RawBody: "low tell me about cats" },
        sessionCtx: { Body: "low tell me about cats", BodyStripped: "low tell me about cats" },
        resolvedThinkLevel: undefined,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    // Think hint extracted before events arrived — level must be "low", not the model default.
    expect(call?.followupRun.run.thinkLevel).toBe("low");
    // The stripped user text (no "low" token) must still appear after the event block.
    expect(call?.commandBody).toContain("tell me about cats");
    expect(call?.commandBody).not.toMatch(/^low\b/);
    // System events are still present in the body.
    expect(call?.commandBody).toContain("System: [t] Node connected.");
  });

  it("carries system events into followupRun.prompt for deferred turns", async () => {
    // drainFormattedSystemEvents returns the events block; the caller prepends it to
    // effectiveBaseBody for the queue path so deferred turns see events.
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce("System: [t] Node connected.");

    await runPreparedReply(baseParams());

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    expect(call?.followupRun.prompt).toContain("System: [t] Node connected.");
  });

  it("does not strip think-hint token from deferred queue body", async () => {
    // In steer mode the inferred thinkLevel is never consumed, so the first token
    // must not be stripped from the queue/steer body (followupRun.prompt).
    vi.mocked(drainFormattedSystemEvents).mockResolvedValueOnce(undefined);

    await runPreparedReply(
      baseParams({
        ctx: { Body: "low steer this conversation", RawBody: "low steer this conversation" },
        sessionCtx: {
          Body: "low steer this conversation",
          BodyStripped: "low steer this conversation",
        },
        resolvedThinkLevel: undefined,
      }),
    );

    const call = vi.mocked(runReplyAgent).mock.calls[0]?.[0];
    expect(call).toBeTruthy();
    // Queue body (used by steer mode) must keep the full original text.
    expect(call?.followupRun.prompt).toContain("low steer this conversation");
  });
});
