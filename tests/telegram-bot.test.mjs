// telegram-bot.test.mjs — tests for Tier 1 callback bot.
// All network calls are stubbed so the suite stays offline.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  handleCallback,
  handleMessage,
  _parseCallbackData,
  _githubApi,
} from "../bin/telegram-bot.js";

// --------------------------------------------------------------------------
// _parseCallbackData tests
// --------------------------------------------------------------------------

describe("_parseCallbackData", () => {
  it("parses valid DECISION callback data", () => {
    const result = _parseCallbackData("DECISION|project-a-store|42|APPROVE");
    expect(result.ok).toBe(true);
    expect(result.type).toBe("DECISION");
    expect(result.repo).toBe("project-a-store");
    expect(result.prNumber).toBe(42);
    expect(result.action).toBe("APPROVE");
  });

  it("handles repo with owner prefix", () => {
    const result = _parseCallbackData("DECISION|acme-org/project-e-now|99|HOLD");
    expect(result.ok).toBe(true);
    expect(result.repo).toBe("acme-org/project-e-now");
    expect(result.prNumber).toBe(99);
    expect(result.action).toBe("HOLD");
  });

  it("parses FEEDBACK action", () => {
    const result = _parseCallbackData("DECISION|project-f-badge|5|FEEDBACK");
    expect(result.ok).toBe(true);
    expect(result.action).toBe("FEEDBACK");
  });

  it("rejects null/undefined data", () => {
    expect(_parseCallbackData(null).ok).toBe(false);
    expect(_parseCallbackData(undefined).ok).toBe(false);
  });

  it("rejects wrong number of parts", () => {
    const result = _parseCallbackData("DECISION|project-a-store|42");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid callback format/);
  });

  it("rejects wrong type prefix", () => {
    const result = _parseCallbackData("ACTION|project-a-store|42|APPROVE");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid callback format/);
  });

  it("rejects invalid action", () => {
    const result = _parseCallbackData("DECISION|project-a-store|42|REJECT");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown action/);
  });

  it("rejects non-numeric PR number", () => {
    const result = _parseCallbackData("DECISION|project-a-store|abc|APPROVE");
    expect(result.ok).toBe(false);
  });
});

// --------------------------------------------------------------------------
// handleCallback tests
// --------------------------------------------------------------------------

describe("handleCallback", () => {
  it("handles APPROVE action", async () => {
    let approveCall = null;
    let mergeCall = null;
    let answerCall = null;

    const mockGithubApi = async ({ method, endpoint, body, token }) => {
      if (endpoint.includes("/reviews")) {
        approveCall = { method, endpoint, body };
        return { status: 200, json: { id: 1 } };
      } else if (endpoint.includes("/merge")) {
        mergeCall = { method, endpoint, body };
        return { status: 200, json: { merged: true } };
      }
      throw new Error("unexpected endpoint");
    };

    const mockAnswerCallback = async (url, payload) => {
      answerCall = payload;
      return { status: 200, json: { ok: true } };
    };

    const callback = {
      callback_query_id: "cq-123",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|project-a-store|42|APPROVE",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const result = await handleCallback(callback, "bot-token", {
      _githubApi: mockGithubApi,
      httpPostJson: mockAnswerCallback,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("APPROVE");
    expect(approveCall.method).toBe("POST");
    expect(approveCall.body.event).toBe("APPROVE");
    expect(mergeCall.method).toBe("PUT");
    expect(answerCall.text).toMatch(/approved.*merged/i);
  });

  it("handles HOLD action", async () => {
    let labelCall = null;
    let answerCall = null;

    const mockGithubApi = async ({ method, endpoint, body, token }) => {
      if (endpoint.includes("/labels")) {
        labelCall = { method, endpoint, body };
        return { status: 200, json: { ok: true } };
      }
      throw new Error("unexpected endpoint");
    };

    const mockAnswerCallback = async (url, payload) => {
      answerCall = payload;
      return { status: 200, json: { ok: true } };
    };

    const callback = {
      callback_query_id: "cq-456",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|project-e-now|99|HOLD",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const result = await handleCallback(callback, "bot-token", {
      _githubApi: mockGithubApi,
      httpPostJson: mockAnswerCallback,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("HOLD");
    expect(labelCall.method).toBe("POST");
    expect(labelCall.body.labels).toContain("hold");
    expect(answerCall.text).toMatch(/hold/i);
  });

  it("handles FEEDBACK action", async () => {
    let answerCall = null;

    const mockAnswerCallback = async (url, payload) => {
      answerCall = payload;
      return { status: 200, json: { ok: true } };
    };

    const callback = {
      callback_query_id: "cq-789",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|project-f-badge|5|FEEDBACK",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const result = await handleCallback(callback, "bot-token", {
      _githubApi: async () => ({ status: 200, json: { ok: true } }),
      httpPostJson: mockAnswerCallback,
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("FEEDBACK");
    expect(answerCall.text).toMatch(/feedback/i);
  });

  it("rejects invalid callback data", async () => {
    let answerCall = null;

    const mockAnswerCallback = async (url, payload) => {
      answerCall = payload;
      return { status: 200, json: { ok: true } };
    };

    const callback = {
      callback_query_id: "cq-bad",
      from: { id: 1, first_name: "Test" },
      data: "INVALID_DATA",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const result = await handleCallback(callback, "bot-token", {
      _githubApi: async () => ({ status: 200, json: { ok: true } }),
      httpPostJson: mockAnswerCallback,
    });

    expect(result.ok).toBe(false);
    expect(answerCall).toBeDefined();
    expect(answerCall.text).toMatch(/error|invalid/i);
  });

  it("handles GitHub API errors gracefully", async () => {
    let answerCall = null;

    const mockGithubApi = async () => {
      throw new Error("GitHub API error: 404 Not Found");
    };

    const mockAnswerCallback = async (url, payload) => {
      answerCall = payload;
      return { status: 200, json: { ok: true } };
    };

    const callback = {
      callback_query_id: "cq-error",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|project-a-store|42|APPROVE",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const result = await handleCallback(callback, "bot-token", {
      _githubApi: mockGithubApi,
      httpPostJson: mockAnswerCallback,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GitHub API error/);
    expect(answerCall).toBeDefined();
    expect(answerCall.show_alert).toBe(true);
  });

  it("prepends default owner from GITHUB_OWNER env if repo has no slash", async () => {
    let capturedEndpoint = null;

    const mockGithubApi = async ({ method, endpoint, body, token }) => {
      capturedEndpoint = endpoint;
      if (endpoint.includes("/reviews")) {
        return { status: 200, json: { id: 1 } };
      } else if (endpoint.includes("/merge")) {
        return { status: 200, json: { merged: true } };
      }
      throw new Error("unexpected endpoint");
    };

    const mockAnswerCallback = async () => ({ status: 200, json: { ok: true } });

    const callback = {
      callback_query_id: "cq-owner",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|my-repo|10|APPROVE",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const prevOwner = process.env.GITHUB_OWNER;
    process.env.GITHUB_OWNER = "acme-org";
    try {
      await handleCallback(callback, "bot-token", {
        _githubApi: mockGithubApi,
        httpPostJson: mockAnswerCallback,
      });
    } finally {
      if (prevOwner === undefined) delete process.env.GITHUB_OWNER;
      else process.env.GITHUB_OWNER = prevOwner;
    }

    // The endpoint should include the configured owner from env.
    expect(capturedEndpoint).toMatch(/acme-org\/my-repo/);
  });

  it("returns ok:false when repo has no slash and no GITHUB_OWNER configured", async () => {
    const mockGithubApi = async () => ({ status: 200, json: { id: 1 } });
    const mockAnswerCallback = async () => ({ status: 200, json: { ok: true } });

    const callback = {
      callback_query_id: "cq-noowner",
      from: { id: 1, first_name: "Test" },
      data: "DECISION|my-repo|10|APPROVE",
      message: { message_id: 1, chat: { id: 999 } },
    };

    const prevOwner = process.env.GITHUB_OWNER;
    const prevTracked = process.env.TRACKED_REPOS;
    delete process.env.GITHUB_OWNER;
    delete process.env.TRACKED_REPOS;
    try {
      const result = await handleCallback(callback, "bot-token", {
        _githubApi: mockGithubApi,
        httpPostJson: mockAnswerCallback,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/owner/i);
    } finally {
      if (prevOwner !== undefined) process.env.GITHUB_OWNER = prevOwner;
      if (prevTracked !== undefined) process.env.TRACKED_REPOS = prevTracked;
    }
  });
});

// --------------------------------------------------------------------------
// handleMessage tests
// --------------------------------------------------------------------------

describe("handleMessage", () => {
  it("handles /status command", async () => {
    let sentMessage = null;

    const mockSendMessage = async (url, payload) => {
      sentMessage = payload;
      return { status: 200, json: { ok: true } };
    };

    const message = {
      chat: { id: 999, type: "private" },
      text: "/status",
    };

    const result = await handleMessage(message, "bot-token", {
      httpPostJson: mockSendMessage,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("status");
    expect(sentMessage.text).toMatch(/status/i);
    expect(sentMessage.chat_id).toBe(999);
  });

  it("handles /help command", async () => {
    let sentMessage = null;

    const mockSendMessage = async (url, payload) => {
      sentMessage = payload;
      return { status: 200, json: { ok: true } };
    };

    const message = {
      chat: { id: 999, type: "private" },
      text: "/help",
    };

    const result = await handleMessage(message, "bot-token", {
      httpPostJson: mockSendMessage,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("help");
    expect(sentMessage.text).toMatch(/command/i);
  });

  it("handles plain text messages", async () => {
    const mockSendMessage = async () => ({ status: 200, json: { ok: true } });

    const message = {
      chat: { id: 999, type: "private" },
      text: "Just some random text",
    };

    const result = await handleMessage(message, "bot-token", {
      httpPostJson: mockSendMessage,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("text");
  });

  it("rejects invalid message structure", async () => {
    const result = await handleMessage({ chat: { id: 999 } }, "bot-token");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid message/);
  });

  it("handles send errors gracefully", async () => {
    const mockSendMessage = async () => {
      throw new Error("Network error");
    };

    const message = {
      chat: { id: 999, type: "private" },
      text: "/status",
    };

    const result = await handleMessage(message, "bot-token", {
      httpPostJson: mockSendMessage,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Network error/);
  });

  it("is case-insensitive for commands", async () => {
    let sentMessage = null;

    const mockSendMessage = async (url, payload) => {
      sentMessage = payload;
      return { status: 200, json: { ok: true } };
    };

    const message = {
      chat: { id: 999, type: "private" },
      text: "/STATUS",
    };

    const result = await handleMessage(message, "bot-token", {
      httpPostJson: mockSendMessage,
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("status");
  });
});
