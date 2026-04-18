// tests/telegram-commands.test.mjs — unit tests for the shared command
// surface used by bin/telegram-bot.js and templates/orchestrator/api/telegram-webhook.js.
// All network I/O is stubbed so the suite stays offline.

import { describe, it, expect } from "vitest";
import {
  parseCommand,
  parseCallback,
  buildPrActionKeyboard,
  buildPrListKeyboard,
  summarizeReviewState,
  isAdmin,
  resolveTrackedRepos,
  resolveAdminChatIds,
  dispatchCommand,
  dispatchCallback,
  cmdStatus,
  cmdList,
  cmdRework,
  cmdApprove,
  cmdDo,
  cmdDigest,
  cmdMerge,
  handleApproveCallback,
  handleRejectCallback,
  handleReworkCallback,
  handleMergeCallback,
  ACTION_CALLBACK_PREFIXES,
} from "../bin/lib/telegram-commands.js";

// --------------------------------------------------------------------------
// parseCommand
// --------------------------------------------------------------------------

describe("parseCommand", () => {
  it("parses bare command", () => {
    expect(parseCommand("/status")).toEqual({ cmd: "/status", args: [], raw: "" });
  });

  it("parses command with args", () => {
    const p = parseCommand("/rework 42");
    expect(p.cmd).toBe("/rework");
    expect(p.args).toEqual(["42"]);
  });

  it("handles /cmd@botname syntax", () => {
    const p = parseCommand("/status@mybot repo-name");
    expect(p.cmd).toBe("/status");
    expect(p.args).toEqual(["repo-name"]);
  });

  it("preserves /do payload verbatim (quoted)", () => {
    const p = parseCommand('/do "refactor the login flow"');
    expect(p.cmd).toBe("/do");
    expect(p.args).toEqual(["refactor the login flow"]);
  });

  it("preserves /do payload verbatim (curly quotes)", () => {
    const p = parseCommand('/do “refactor the login flow”');
    expect(p.cmd).toBe("/do");
    expect(p.args[0]).toBe("refactor the login flow");
  });

  it("preserves /do payload verbatim (bare)", () => {
    const p = parseCommand("/do refactor the login flow");
    expect(p.cmd).toBe("/do");
    expect(p.args[0]).toBe("refactor the login flow");
  });

  it("returns null for non-slash text", () => {
    expect(parseCommand("hello")).toBe(null);
    expect(parseCommand("")).toBe(null);
    expect(parseCommand(null)).toBe(null);
  });

  it("normalizes case", () => {
    expect(parseCommand("/STATUS").cmd).toBe("/status");
    expect(parseCommand("/Rework 1").cmd).toBe("/rework");
  });
});

// --------------------------------------------------------------------------
// parseCallback
// --------------------------------------------------------------------------

describe("parseCallback", () => {
  it("parses new ACTION|repo|pr format — APPROVE", () => {
    const r = parseCallback("APPROVE|owner/repo|42");
    expect(r.ok).toBe(true);
    expect(r.type).toBe("ACTION");
    expect(r.action).toBe("APPROVE");
    expect(r.repo).toBe("owner/repo");
    expect(r.prNumber).toBe(42);
  });

  it("parses REJECT|REWORK|MERGE", () => {
    expect(parseCallback("REJECT|owner/repo|10").action).toBe("REJECT");
    expect(parseCallback("REWORK|owner/repo|11").action).toBe("REWORK");
    expect(parseCallback("MERGE|owner/repo|12").action).toBe("MERGE");
  });

  it("keeps legacy DECISION|repo|pr|action backward-compatible", () => {
    const r = parseCallback("DECISION|owner/repo|42|APPROVE");
    expect(r.ok).toBe(true);
    expect(r.type).toBe("DECISION");
    expect(r.action).toBe("APPROVE");
    expect(r.prNumber).toBe(42);
  });

  it("rejects missing fields", () => {
    expect(parseCallback("APPROVE|owner").ok).toBe(false);
    expect(parseCallback("").ok).toBe(false);
    expect(parseCallback(null).ok).toBe(false);
  });

  it("rejects unknown action", () => {
    expect(parseCallback("ZZZZ|owner/repo|1").ok).toBe(false);
  });

  it("rejects non-numeric PR", () => {
    expect(parseCallback("APPROVE|owner/repo|abc").ok).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Inline keyboards
// --------------------------------------------------------------------------

describe("buildPrActionKeyboard", () => {
  it("returns all four action buttons", () => {
    const kb = buildPrActionKeyboard({ repo: "owner/r", prNumber: 7 });
    const flat = kb.inline_keyboard.flat();
    const actions = flat.map((b) => (b.callback_data || "").split("|")[0]).filter(Boolean);
    expect(actions).toEqual(expect.arrayContaining(["APPROVE", "REJECT", "REWORK", "MERGE"]));
  });

  it("includes Open PR button when prUrl supplied", () => {
    const kb = buildPrActionKeyboard({
      repo: "owner/r",
      prNumber: 7,
      prUrl: "https://github.com/owner/r/pull/7",
    });
    const urls = kb.inline_keyboard.flat().filter((b) => b.url);
    expect(urls.some((b) => b.url.includes("/pull/7"))).toBe(true);
  });

  it("returns empty keyboard when inputs missing", () => {
    expect(buildPrActionKeyboard({}).inline_keyboard).toEqual([]);
  });
});

describe("buildPrListKeyboard", () => {
  it("emits one action row per PR", () => {
    const kb = buildPrListKeyboard([
      { repo: "a/b", prNumber: 1 },
      { repo: "a/c", prNumber: 2 },
    ]);
    // 2 label rows + 2 action rows = 4
    expect(kb.inline_keyboard).toHaveLength(4);
    const callbacks = kb.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);
    expect(callbacks).toContain("APPROVE|a/b|1");
    expect(callbacks).toContain("MERGE|a/c|2");
  });
});

// --------------------------------------------------------------------------
// Env helpers
// --------------------------------------------------------------------------

describe("resolveTrackedRepos", () => {
  it("prefers explicit arg", () => {
    expect(resolveTrackedRepos({ TRACKED_REPOS: "x/y" }, ["a/b"])).toEqual(["a/b"]);
  });

  it("uses TRACKED_REPOS next", () => {
    expect(resolveTrackedRepos({ TRACKED_REPOS: "x/y, a/b" })).toEqual(["x/y", "a/b"]);
  });

  it("falls back to PRODUCT_REPOS", () => {
    expect(resolveTrackedRepos({ PRODUCT_REPOS: "p/q" })).toEqual(["p/q"]);
  });

  it("returns empty when nothing configured", () => {
    expect(resolveTrackedRepos({})).toEqual([]);
  });
});

describe("isAdmin", () => {
  it("rejects when admin list is empty", () => {
    expect(isAdmin(999, [])).toBe(false);
    expect(isAdmin(999, "")).toBe(false);
  });

  it("accepts matching chat id as string or number", () => {
    expect(isAdmin(123, ["123"])).toBe(true);
    expect(isAdmin("123", ["123"])).toBe(true);
    expect(isAdmin(123, [123])).toBe(true);
  });

  it("rejects non-member", () => {
    expect(isAdmin(999, ["123", "456"])).toBe(false);
  });

  it("reads CSV from string", () => {
    expect(isAdmin(123, "123,456")).toBe(true);
    expect(resolveAdminChatIds({ TELEGRAM_ADMIN_CHAT_IDS: "1,2, 3" })).toEqual(["1", "2", "3"]);
  });
});

// --------------------------------------------------------------------------
// summarizeReviewState
// --------------------------------------------------------------------------

describe("summarizeReviewState", () => {
  it("returns awaiting for empty", () => {
    expect(summarizeReviewState([])).toBe("awaiting");
  });

  it("changes-requested dominates approved", () => {
    expect(summarizeReviewState([{ state: "APPROVED" }, { state: "CHANGES_REQUESTED" }])).toBe(
      "changes-requested"
    );
  });

  it("approved when only approvals", () => {
    expect(summarizeReviewState([{ state: "APPROVED" }])).toBe("approved");
  });

  it("awaiting when only COMMENTED", () => {
    expect(summarizeReviewState([{ state: "COMMENTED" }])).toBe("awaiting");
  });
});

// --------------------------------------------------------------------------
// Command dispatch: authorization
// --------------------------------------------------------------------------

describe("dispatchCommand authorization", () => {
  const ghApi = async () => [];

  it("blocks /merge from non-admin chat", async () => {
    const parsed = parseCommand("/merge 42");
    const result = await dispatchCommand(parsed, {
      chatId: 999,
      env: {},
      ghApi,
      trackedRepos: ["owner/repo"],
      adminChatIds: ["123"],
    });
    expect(result.handled).toBe(true);
    expect(result.response.text).toBe("Not authorized");
  });

  it("allows /merge from admin chat", async () => {
    let mergeCalled = false;
    const ghApi2 = async (endpoint, opts) => {
      if (endpoint.includes("/pulls/42") && !endpoint.includes("/merge")) {
        return { number: 42, html_url: "https://github.com/owner/repo/pull/42", head: { ref: "feat" } };
      }
      if (endpoint.endsWith("/merge") && opts?.method === "PUT") {
        mergeCalled = true;
        return { merged: true };
      }
      return {};
    };
    const parsed = parseCommand("/merge 42");
    const result = await dispatchCommand(parsed, {
      chatId: 123,
      env: {},
      ghApi: ghApi2,
      trackedRepos: ["owner/repo"],
      adminChatIds: ["123"],
    });
    expect(result.handled).toBe(true);
    expect(mergeCalled).toBe(true);
  });

  it("allows non-admin commands from any chat", async () => {
    const parsed = parseCommand("/approve 42");
    const ghCalls = [];
    const ghApi2 = async (endpoint, opts) => {
      ghCalls.push({ endpoint, method: opts?.method || "GET" });
      if (endpoint.includes("/pulls/42") && !endpoint.includes("/reviews")) {
        return { number: 42, html_url: "u", head: { ref: "b" } };
      }
      return {};
    };
    const result = await dispatchCommand(parsed, {
      chatId: 999,
      env: {},
      ghApi: ghApi2,
      trackedRepos: ["owner/repo"],
      adminChatIds: ["123"],
    });
    expect(result.handled).toBe(true);
    expect(result.response.text).toMatch(/Approved/);
  });
});

// --------------------------------------------------------------------------
// Callback dispatch
// --------------------------------------------------------------------------

describe("dispatchCallback", () => {
  it("routes APPROVE", async () => {
    const calls = [];
    const ghApi = async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method });
      return {};
    };
    const result = await dispatchCallback("APPROVE|owner/repo|7", {
      chatId: 1,
      env: {},
      ghApi,
      trackedRepos: [],
      adminChatIds: [],
    });
    expect(result.handled).toBe(true);
    expect(result.action).toBe("APPROVE");
    expect(result.response.ok).toBe(true);
    expect(calls.some((c) => c.endpoint.endsWith("/reviews") && c.method === "POST")).toBe(true);
  });

  it("routes REJECT (adds needs-work label + comment)", async () => {
    const calls = [];
    const ghApi = async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method, body: opts?.body });
      return {};
    };
    const result = await dispatchCallback("REJECT|owner/repo|7", {
      chatId: 1,
      env: {},
      ghApi,
      trackedRepos: [],
      adminChatIds: [],
    });
    expect(result.handled).toBe(true);
    const labelCall = calls.find((c) => c.endpoint.endsWith("/labels"));
    expect(labelCall.body.labels).toContain("needs-work");
    expect(calls.some((c) => c.endpoint.endsWith("/comments"))).toBe(true);
  });

  it("blocks MERGE from non-admin", async () => {
    let mergeCalled = false;
    const ghApi = async (endpoint, opts) => {
      if (endpoint.endsWith("/merge")) mergeCalled = true;
      return {};
    };
    const result = await dispatchCallback("MERGE|owner/repo|7", {
      chatId: 999,
      env: {},
      ghApi,
      trackedRepos: [],
      adminChatIds: ["123"],
    });
    expect(result.handled).toBe(true);
    expect(result.response.ok).toBe(false);
    expect(result.response.text).toBe("Not authorized");
    expect(mergeCalled).toBe(false);
  });

  it("allows MERGE from admin", async () => {
    let mergeCalled = false;
    const ghApi = async (endpoint, opts) => {
      if (endpoint.endsWith("/merge") && opts?.method === "PUT") mergeCalled = true;
      return {};
    };
    const result = await dispatchCallback("MERGE|owner/repo|7", {
      chatId: 123,
      env: {},
      ghApi,
      trackedRepos: [],
      adminChatIds: ["123"],
    });
    expect(result.handled).toBe(true);
    expect(mergeCalled).toBe(true);
  });

  it("surfaces legacy DECISION|repo|pr|HOLD so caller can handle", async () => {
    const result = await dispatchCallback("DECISION|owner/repo|7|HOLD", {
      chatId: 1,
      env: {},
      ghApi: async () => ({}),
      trackedRepos: [],
      adminChatIds: [],
    });
    expect(result.handled).toBe(false);
    expect(result.legacy).toBe(true);
  });
});

// --------------------------------------------------------------------------
// cmdStatus / cmdList / cmdDigest — minimal smoke tests
// --------------------------------------------------------------------------

describe("cmdStatus", () => {
  it("asks for config when no tracked repos", async () => {
    const result = await cmdStatus({
      args: [],
      ghApi: async () => [],
      trackedRepos: [],
      env: {},
      adminChatIds: [],
    });
    expect(result.text).toMatch(/TRACKED_REPOS|PRODUCT_REPOS/);
  });

  it("lists open non-draft PRs with review state", async () => {
    const ghApi = async (endpoint) => {
      if (endpoint.includes("/pulls?state=open")) {
        return [
          { number: 1, title: "Fix", html_url: "u", draft: false },
          { number: 2, title: "Draft", html_url: "u2", draft: true }, // excluded
        ];
      }
      if (endpoint.includes("/reviews")) {
        return [{ state: "APPROVED" }];
      }
      return [];
    };
    const result = await cmdStatus({
      args: [],
      ghApi,
      trackedRepos: ["owner/repo"],
      env: {},
      adminChatIds: [],
    });
    expect(result.text).toContain("#1");
    expect(result.text).not.toContain("Draft");
    expect(result.text).toContain("approved");
    expect(result.extra.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });
});

describe("cmdList", () => {
  it("returns last 10 PRs sorted by updated_at", async () => {
    const ghApi = async (endpoint) => {
      if (endpoint.includes("/pulls?state=all")) {
        return [
          { number: 9, title: "Newer", updated_at: "2025-01-02T00:00:00Z", html_url: "u9" },
          { number: 8, title: "Older", updated_at: "2025-01-01T00:00:00Z", html_url: "u8" },
        ];
      }
      return [];
    };
    const result = await cmdList({
      args: [],
      ghApi,
      trackedRepos: ["owner/repo"],
      env: {},
      adminChatIds: [],
    });
    expect(result.text).toMatch(/#9.*Newer/);
    // "Newer" should appear before "Older"
    const newerIdx = result.text.indexOf("Newer");
    const olderIdx = result.text.indexOf("Older");
    expect(newerIdx).toBeLessThan(olderIdx);
  });
});

describe("cmdDo", () => {
  it("creates an inbox issue with nl-order label", async () => {
    const calls = [];
    const ghApi = async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method, body: opts?.body });
      if (endpoint.endsWith("/issues") && opts?.method === "POST") {
        return { number: 42, html_url: "https://github.com/me/solo-cto-agent-inbox/issues/42" };
      }
      return {};
    };
    const result = await cmdDo({
      args: ['"refactor login"'],
      ghApi,
      trackedRepos: [],
      env: { GITHUB_OWNER: "me" },
      adminChatIds: [],
    });
    // /do parser strips the outer quotes via parseCommand, so we simulate
    // the unquoted payload here by passing the bare string too:
    expect(result.text).toMatch(/Queued as inbox issue/);
    const issueCall = calls.find((c) => c.endpoint.includes("/issues") && c.method === "POST");
    expect(issueCall.body.labels).toContain("nl-order");
  });

  it("rejects missing payload", async () => {
    const result = await cmdDo({
      args: [""],
      ghApi: async () => ({}),
      trackedRepos: [],
      env: { GITHUB_OWNER: "me" },
      adminChatIds: [],
    });
    expect(result.text).toMatch(/Usage/);
  });

  it("rejects when GITHUB_OWNER missing", async () => {
    const result = await cmdDo({
      args: ["do the thing"],
      ghApi: async () => ({}),
      trackedRepos: [],
      env: {},
      adminChatIds: [],
    });
    expect(result.text).toMatch(/GITHUB_OWNER/);
  });
});

describe("cmdRework", () => {
  it("dispatches rework-request event", async () => {
    const calls = [];
    const ghApi = async (endpoint, opts) => {
      calls.push({ endpoint, method: opts?.method, body: opts?.body });
      if (endpoint.includes("/pulls/42") && !endpoint.includes("/dispatches")) {
        return { number: 42, html_url: "u", head: { ref: "feat" } };
      }
      return {};
    };
    const result = await cmdRework({
      args: ["42"],
      ghApi,
      trackedRepos: ["owner/repo"],
      env: { ORCH_REPO_SLUG: "owner/orch" },
      adminChatIds: [],
    });
    expect(result.text).toMatch(/Rework dispatched/);
    const dispatchCall = calls.find((c) => c.endpoint.includes("/dispatches"));
    expect(dispatchCall.body.event_type).toBe("rework-request");
    expect(dispatchCall.body.client_payload.pr).toBe(42);
  });
});

describe("ACTION_CALLBACK_PREFIXES", () => {
  it("exposes the expected set", () => {
    expect(ACTION_CALLBACK_PREFIXES).toEqual(["APPROVE", "REJECT", "REWORK", "MERGE"]);
  });
});
