/**
 * nl-orchestrator tests — cover the pure parsing + validation + dispatch
 * surface. Anthropic and GitHub APIs are stubbed via injected objects.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);
const nl = require(path.join(process.cwd(), "bin", "lib", "nl-orchestrator.js"));

const TRACKED = [
  { name: "tribo-store", fullName: "acme/tribo-store", description: "K-beauty group buying", language: "TypeScript", pushedAt: "2026-04-18" },
  { name: "ohmywork", fullName: "acme/ohmywork", description: "B2G field-practice platform", language: "TypeScript", pushedAt: "2026-04-17" },
  { name: "pista-app", fullName: "acme/pista-app", description: "PH social gifting", language: "TypeScript", pushedAt: "2026-04-16" },
];

// ── looksLikeDesignTask ───────────────────────────────────────────────────
describe("looksLikeDesignTask", () => {
  it("matches English design keywords", () => {
    expect(nl.looksLikeDesignTask("redesign the landing page hero")).toBe(true);
    expect(nl.looksLikeDesignTask("improve the button styling")).toBe(true);
    expect(nl.looksLikeDesignTask("fix the dark mode contrast")).toBe(true);
  });
  it("matches Korean design keywords", () => {
    expect(nl.looksLikeDesignTask("로그인 페이지 디자인 개선")).toBe(true);
    expect(nl.looksLikeDesignTask("레이아웃 수정해줘")).toBe(true);
  });
  it("does not match pure backend tasks", () => {
    expect(nl.looksLikeDesignTask("fix the off-by-one in the ARPU calculator")).toBe(false);
    expect(nl.looksLikeDesignTask("add retry logic to the API client")).toBe(false);
  });
  it("handles empty input safely", () => {
    expect(nl.looksLikeDesignTask("")).toBe(false);
    expect(nl.looksLikeDesignTask(null)).toBe(false);
    expect(nl.looksLikeDesignTask(undefined)).toBe(false);
  });
});

// ── extractJson ──────────────────────────────────────────────────────────
describe("extractJson", () => {
  it("extracts from fenced ```json block", () => {
    const out = nl.extractJson('here you go:\n```json\n{"a":1,"b":"x"}\n```\n');
    expect(out).toEqual({ a: 1, b: "x" });
  });
  it("extracts from fenced ``` block without json tag", () => {
    const out = nl.extractJson("```\n{\"n\":5}\n```");
    expect(out).toEqual({ n: 5 });
  });
  it("extracts unfenced JSON with trailing prose", () => {
    const out = nl.extractJson('{"foo": "bar"}\n\nsome prose after');
    expect(out).toEqual({ foo: "bar" });
  });
  it("handles nested objects", () => {
    const out = nl.extractJson('```json\n{"outer":{"inner":[1,2,{"x":"y"}]}}\n```');
    expect(out).toEqual({ outer: { inner: [1, 2, { x: "y" }] } });
  });
  it("returns null on malformed JSON", () => {
    expect(nl.extractJson("```json\n{not valid}\n```")).toBeNull();
    expect(nl.extractJson("no braces at all")).toBeNull();
    expect(nl.extractJson(null)).toBeNull();
  });
});

// ── validateIntent ───────────────────────────────────────────────────────
describe("validateIntent", () => {
  const valid = {
    repo: "acme/tribo-store",
    title: "Fix login redirect",
    body: "context...",
    agent: "claude",
    scope: "code",
    confidence: "high",
  };

  it("passes a valid intent", () => {
    expect(() => nl.validateIntent(valid, TRACKED)).not.toThrow();
  });
  it("rejects missing fields", () => {
    for (const f of ["repo", "title", "body", "agent", "scope", "confidence"]) {
      const bad = { ...valid };
      delete bad[f];
      expect(() => nl.validateIntent(bad, TRACKED)).toThrow(new RegExp(f));
    }
  });
  it("rejects repo not in tracked list", () => {
    expect(() => nl.validateIntent({ ...valid, repo: "acme/unknown" }, TRACKED)).toThrow(/not in tracked/);
  });
  it("rejects invalid agent", () => {
    expect(() => nl.validateIntent({ ...valid, agent: "gemini" }, TRACKED)).toThrow(/agent/);
  });
  it("rejects invalid scope", () => {
    expect(() => nl.validateIntent({ ...valid, scope: "infra" }, TRACKED)).toThrow(/scope/);
  });
  it("rejects null / non-object", () => {
    expect(() => nl.validateIntent(null, TRACKED)).toThrow(/no JSON/);
    expect(() => nl.validateIntent("string", TRACKED)).toThrow(/no JSON/);
  });
});

// ── parseIntent with mocked Anthropic ────────────────────────────────────
function mockAnthropic(jsonOut) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: `Here is the dispatch intent:\n\`\`\`json\n${JSON.stringify(jsonOut)}\n\`\`\`` }],
      }),
    },
  };
}

describe("parseIntent", () => {
  it("returns a validated intent", async () => {
    const want = {
      repo: "acme/tribo-store",
      title: "Improve empty-cart state",
      body: "The empty cart currently shows a generic message...",
      agent: "claude",
      scope: "design",
      confidence: "medium",
    };
    const intent = await nl.parseIntent({
      userText: "redesign the empty cart on tribo",
      trackedRepos: TRACKED,
      anthropicClient: mockAnthropic(want),
    });
    expect(intent.repo).toBe("acme/tribo-store");
    expect(intent.scope).toBe("design");
  });

  it("upgrades scope to design when userText is clearly design but LLM missed it", async () => {
    const want = {
      repo: "acme/tribo-store",
      title: "Improve empty-cart state",
      body: "...",
      agent: "claude",
      scope: "code", // LLM said code
      confidence: "medium",
    };
    const intent = await nl.parseIntent({
      userText: "redesign the landing page layout and typography",
      trackedRepos: TRACKED,
      anthropicClient: mockAnthropic(want),
    });
    expect(intent.scope).toBe("design"); // post-processing override
  });

  it("throws when LLM returns unparseable text", async () => {
    const badClient = { messages: { create: async () => ({ content: [{ text: "no json here" }] }) } };
    await expect(
      nl.parseIntent({ userText: "x", trackedRepos: TRACKED, anthropicClient: badClient })
    ).rejects.toThrow(/no JSON/);
  });

  it("throws when userText is empty", async () => {
    await expect(
      nl.parseIntent({ userText: "", trackedRepos: TRACKED, anthropicClient: mockAnthropic({}) })
    ).rejects.toThrow(/userText/);
  });

  it("throws when trackedRepos is not an array", async () => {
    await expect(
      nl.parseIntent({ userText: "hi", trackedRepos: null, anthropicClient: mockAnthropic({}) })
    ).rejects.toThrow(/trackedRepos/);
  });
});

// ── dispatchOrder with mocked Octokit ────────────────────────────────────
describe("dispatchOrder", () => {
  function mockGh() {
    const calls = [];
    return {
      calls,
      issues: {
        create: async (args) => {
          calls.push(args);
          return {
            data: {
              html_url: `https://github.com/${args.owner}/${args.repo}/issues/42`,
              number: 42,
            },
          };
        },
      },
    };
  }

  const intent = {
    repo: "acme/tribo-store",
    title: "Fix auth",
    body: "...",
    agent: "claude",
    scope: "code",
    confidence: "high",
  };

  it("creates an issue with the right labels on the target repo", async () => {
    const gh = mockGh();
    const out = await nl.dispatchOrder({ intent, ghApi: gh });
    expect(out.issueNumber).toBe(42);
    expect(out.repo).toBe("acme/tribo-store");
    expect(gh.calls).toHaveLength(1);
    const c = gh.calls[0];
    expect(c.owner).toBe("acme");
    expect(c.repo).toBe("tribo-store");
    expect(c.labels).toContain("agent-claude");
    expect(c.labels).toContain("nl-order");
    expect(c.labels).not.toContain("design-review");
  });

  it("adds design-review label when scope=design", async () => {
    const gh = mockGh();
    await nl.dispatchOrder({ intent: { ...intent, scope: "design" }, ghApi: gh });
    expect(gh.calls[0].labels).toContain("design-review");
  });

  it("adds needs-clarification label when confidence=low", async () => {
    const gh = mockGh();
    await nl.dispatchOrder({ intent: { ...intent, confidence: "low" }, ghApi: gh });
    expect(gh.calls[0].labels).toContain("needs-clarification");
  });

  it("rejects a malformed repo slug", async () => {
    const gh = mockGh();
    await expect(
      nl.dispatchOrder({ intent: { ...intent, repo: "no-slash" }, ghApi: gh })
    ).rejects.toThrow(/malformed/);
  });

  it("embeds meta footer in issue body", async () => {
    const gh = mockGh();
    await nl.dispatchOrder({ intent, ghApi: gh });
    expect(gh.calls[0].body).toContain("**scope:** code");
    expect(gh.calls[0].body).toContain("**agent:** claude");
    expect(gh.calls[0].body).toContain("**via:** nl-order");
  });
});

// ── parseAndDispatch end-to-end with both mocked ─────────────────────────
describe("parseAndDispatch", () => {
  it("parses and dispatches in one shot", async () => {
    const anth = mockAnthropic({
      repo: "acme/ohmywork",
      title: "Add field-report export",
      body: "The operator dashboard needs a CSV export of daily field reports.",
      agent: "codex",
      scope: "code",
      confidence: "high",
    });
    const ghCalls = [];
    const gh = {
      issues: {
        create: async (a) => {
          ghCalls.push(a);
          return { data: { html_url: "https://x/1", number: 1 } };
        },
      },
    };
    const out = await nl.parseAndDispatch({
      userText: "add field-report CSV export in ohmywork",
      trackedRepos: TRACKED,
      anthropicClient: anth,
      ghApi: gh,
    });
    expect(out.repo).toBe("acme/ohmywork");
    expect(out.agent).toBe("codex");
    expect(ghCalls[0].labels).toContain("agent-codex");
  });
});
