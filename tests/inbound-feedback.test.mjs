// PR-E4 — Inbound feedback channel parser/router tests.

import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const inbound = require("../bin/inbound-feedback.js");

describe("sanitizeVerdict / sanitizeSeverity", () => {
  it("accepts variants", () => {
    expect(inbound.sanitizeVerdict("accept")).toBe("accept");
    expect(inbound.sanitizeVerdict("accepted")).toBe("accept");
    expect(inbound.sanitizeVerdict("APPROVE")).toBe("accept");
    expect(inbound.sanitizeVerdict("reject")).toBe("reject");
    expect(inbound.sanitizeVerdict("DISPUTE")).toBe("reject");
  });

  it("returns null for unknown verdict", () => {
    expect(inbound.sanitizeVerdict("maybe")).toBeNull();
    expect(inbound.sanitizeVerdict("")).toBeNull();
    expect(inbound.sanitizeVerdict(null)).toBeNull();
  });

  it("canonicalizes severity", () => {
    expect(inbound.sanitizeSeverity("blocker")).toBe("BLOCKER");
    expect(inbound.sanitizeSeverity("SUGGESTION")).toBe("SUGGESTION");
    expect(inbound.sanitizeSeverity("nit")).toBe("NIT");
    expect(inbound.sanitizeSeverity("foo")).toBe("UNKNOWN");
    expect(inbound.sanitizeSeverity(null)).toBe("UNKNOWN");
  });
});

describe("parseSlackInteraction", () => {
  it("parses a button action with feedback|verdict|location|severity", () => {
    const p = {
      user: { username: "seunghun" },
      actions: [
        { action_id: "fb_btn", value: "feedback|accept|src/Btn.tsx:42|BLOCKER" },
      ],
    };
    const r = inbound.parseSlackInteraction(p);
    expect(r.source).toBe("slack");
    expect(r.verdict).toBe("accept");
    expect(r.location).toBe("src/Btn.tsx:42");
    expect(r.severity).toBe("BLOCKER");
    expect(r.attribution).toBe("seunghun");
  });

  it("returns null when no feedback action present", () => {
    const p = { actions: [{ value: "other|thing" }] };
    expect(inbound.parseSlackInteraction(p)).toBeNull();
  });

  it("returns null for empty payload", () => {
    expect(inbound.parseSlackInteraction(null)).toBeNull();
    expect(inbound.parseSlackInteraction({})).toBeNull();
  });

  it("returns null when verdict is invalid", () => {
    const p = {
      actions: [{ value: "feedback|maybe|src/a.ts|SUGGESTION" }],
    };
    expect(inbound.parseSlackInteraction(p)).toBeNull();
  });

  it("pulls free-text note from state.values", () => {
    const p = {
      user: { username: "u" },
      actions: [{ value: "feedback|reject|src/X.ts:5|SUGGESTION" }],
      state: { values: { blk: { reason_input: { value: "already memoized" } } } },
    };
    const r = inbound.parseSlackInteraction(p);
    expect(r.note).toBe("already memoized");
  });

  it("defaults severity to UNKNOWN when missing", () => {
    const p = { actions: [{ value: "feedback|accept|src/a.ts" }] };
    const r = inbound.parseSlackInteraction(p);
    expect(r.severity).toBe("UNKNOWN");
  });

  it("falls back to user.id when no username/name", () => {
    const p = {
      user: { id: "U123" },
      actions: [{ value: "feedback|accept|src/a.ts|NIT" }],
    };
    expect(inbound.parseSlackInteraction(p).attribution).toBe("U123");
  });
});

describe("parseGitHubDispatch", () => {
  it("parses repository_dispatch client_payload with verdict + location", () => {
    const p = {
      client_payload: {
        type: "feedback",
        verdict: "reject",
        location: "src/Nav.tsx:12",
        severity: "SUGGESTION",
        note: "already memoized",
        actor: "octocat",
      },
    };
    const r = inbound.parseGitHubDispatch(p);
    expect(r.source).toBe("github");
    expect(r.verdict).toBe("reject");
    expect(r.location).toBe("src/Nav.tsx:12");
    expect(r.severity).toBe("SUGGESTION");
    expect(r.note).toBe("already memoized");
    expect(r.attribution).toBe("octocat");
  });

  it("accepts flat payload (no client_payload wrapper)", () => {
    const r = inbound.parseGitHubDispatch({
      verdict: "accept", location: "a.ts:1", severity: "BLOCKER",
    });
    expect(r.verdict).toBe("accept");
  });

  it("flags legacy category/detail form as unrecordable", () => {
    const p = {
      client_payload: {
        type: "feedback",
        category: "review-quality",
        detail: "Claude missed a real issue",
      },
    };
    const r = inbound.parseGitHubDispatch(p);
    expect(r.unrecordable).toBe(true);
    expect(r.reason).toMatch(/no location/);
    expect(r.category).toBe("review-quality");
  });

  it("returns null for empty payload", () => {
    expect(inbound.parseGitHubDispatch(null)).toBeNull();
    expect(inbound.parseGitHubDispatch({})).toBeNull();
    expect(inbound.parseGitHubDispatch({ client_payload: {} })).toBeNull();
  });

  it("returns null when verdict invalid and no category/detail", () => {
    expect(inbound.parseGitHubDispatch({
      client_payload: { verdict: "hmm", location: "a.ts:1" },
    })).toBeNull();
  });
});

describe("parseGeneric", () => {
  it("parses a normalized payload", () => {
    const r = inbound.parseGeneric({
      verdict: "accept", location: "x.ts:1", severity: "BLOCKER", source: "cli",
    });
    expect(r.verdict).toBe("accept");
    expect(r.source).toBe("cli");
  });

  it("returns null when fields are missing", () => {
    expect(inbound.parseGeneric({ verdict: "accept" })).toBeNull();
    expect(inbound.parseGeneric({ location: "x" })).toBeNull();
    expect(inbound.parseGeneric(null)).toBeNull();
  });
});

describe("parseInbound dispatcher", () => {
  it("routes to slack parser", () => {
    const r = inbound.parseInbound({ source: "slack", payload: {
      actions: [{ value: "feedback|accept|a.ts:1|BLOCKER" }],
    }});
    expect(r.source).toBe("slack");
  });

  it("routes to github parser", () => {
    const r = inbound.parseInbound({ source: "github", payload: {
      verdict: "accept", location: "a.ts:1",
    }});
    expect(r.source).toBe("github");
  });

  it("defaults to generic", () => {
    const r = inbound.parseInbound({ source: "", payload: {
      verdict: "accept", location: "a.ts:1",
    }});
    expect(r.source).toBe("generic");
  });

  it("returns null for unsupported source", () => {
    expect(inbound.parseInbound({ source: "webhook", payload: {} })).toBeNull();
  });
});

describe("applyInboundFeedback (with recordImpl stub)", () => {
  it("calls recordFeedback with attributed note", () => {
    const calls = [];
    const recordImpl = (args) => { calls.push(args); return { verdict: args.verdict, ok: true }; };
    const parsed = {
      source: "slack", verdict: "accept", location: "src/a.ts:1", severity: "BLOCKER",
      note: "real bug", attribution: "seunghun",
    };
    const r = inbound.applyInboundFeedback(parsed, { recordImpl });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].note).toBe("[via slack:seunghun] real bug");
    expect(calls[0].verdict).toBe("accept");
  });

  it("returns ok:false when parsed is null", () => {
    const r = inbound.applyInboundFeedback(null);
    expect(r.ok).toBe(false);
  });

  it("returns ok:false for unrecordable legacy payload", () => {
    const r = inbound.applyInboundFeedback({
      unrecordable: true, reason: "no location", category: "x", source: "github",
    }, { recordImpl: () => { throw new Error("should not run"); } });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no location/);
  });

  it("surfaces recordImpl errors", () => {
    const recordImpl = () => { throw new Error("disk full"); };
    const parsed = {
      source: "slack", verdict: "reject", location: "a.ts:1", severity: "NIT",
      note: "", attribution: "u",
    };
    const r = inbound.applyInboundFeedback(parsed, { recordImpl });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk full/);
  });

  it("still records when note is empty (attribution-only)", () => {
    const calls = [];
    const recordImpl = (args) => { calls.push(args); return { ok: true }; };
    const parsed = {
      source: "github", verdict: "accept", location: "a.ts:1", severity: "BLOCKER",
      note: "", attribution: "octocat",
    };
    inbound.applyInboundFeedback(parsed, { recordImpl });
    expect(calls[0].note).toBe("[via github:octocat]");
  });
});

describe("handleInbound (parse + apply)", () => {
  it("full slack path", () => {
    const calls = [];
    const recordImpl = (args) => { calls.push(args); return { ok: true }; };
    const r = inbound.handleInbound({
      source: "slack",
      payload: {
        user: { username: "u1" },
        actions: [{ value: "feedback|accept|a.ts:1|BLOCKER" }],
      },
      recordImpl,
    });
    expect(r.ok).toBe(true);
    expect(calls[0].location).toBe("a.ts:1");
  });

  it("returns ok:false when payload cannot be parsed", () => {
    const r = inbound.handleInbound({ source: "slack", payload: {} });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not parse/);
  });
});
