/**
 * cross-reviewer-consensus.test.mjs
 *
 * Unit tests for the pure parsing / decision logic in the new consensus-loop
 * cross-reviewer. We intentionally DO NOT mock the OpenAI / Anthropic SDKs;
 * we test only the round-decision and parser paths with synthetic fixtures,
 * which is where the correctness risk actually lives.
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require_ = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = require_(
  path.join(
    repoRoot,
    "templates",
    "orchestrator",
    "ops",
    "agents",
    "cross-reviewer.js"
  )
);

const {
  parseIssueList,
  parseReviewResponse,
  decideNextRound,
  mergeConsensus,
  classifyConsensus,
  finalVerdictFrom,
  normalizeConfidence,
  buildComment,
} = mod;

// ---------------------------------------------------------------------------
// parseIssueList
// ---------------------------------------------------------------------------

describe("parseIssueList", () => {
  it("parses a well-formed classified list", () => {
    const txt = `[BLOCKER] [HIGH] Null deref in src/a.js:42 when user is undefined
[SUGGESTION] [MED] Extract duplicated retry helper
[NIT] [LOW] Rename \`foo\` to \`fooValue\` for clarity`;
    const items = parseIssueList(txt);
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("BLOCKER");
    expect(items[0].confidence).toBe("HIGH");
    expect(items[0].text).toMatch(/Null deref/);
    expect(items[1].kind).toBe("SUGGESTION");
    expect(items[2].confidence).toBe("LOW");
  });

  it("tolerates bullet prefixes and bracket-less kinds", () => {
    const txt = `- BLOCKER HIGH: missing auth check in /api/users
1. SUGGESTION MED: add test coverage for error branch
* NIT LOW: typo in comment`;
    const items = parseIssueList(txt);
    expect(items).toHaveLength(3);
    expect(items[0].kind).toBe("BLOCKER");
    expect(items[2].kind).toBe("NIT");
  });

  it("returns empty array on NONE / empty / prose-only output", () => {
    expect(parseIssueList("NONE")).toEqual([]);
    expect(parseIssueList("")).toEqual([]);
    expect(parseIssueList(null)).toEqual([]);
    // Pure prose (no KIND token) — must not produce phantom items.
    expect(parseIssueList("The code looks fine to me, great job.")).toEqual([]);
  });

  it("defaults missing confidence to MED", () => {
    const items = parseIssueList("[BLOCKER] regression in session handling");
    expect(items).toHaveLength(1);
    expect(items[0].confidence).toBe("MED");
  });

  it("accepts MEDIUM as alias for MED", () => {
    expect(normalizeConfidence("MEDIUM")).toBe("MED");
    expect(normalizeConfidence("High")).toBe("HIGH");
    expect(normalizeConfidence("low")).toBe("LOW");
    expect(normalizeConfidence("unknown")).toBe("MED");
  });
});

// ---------------------------------------------------------------------------
// parseReviewResponse (Agent B round 2 format)
// ---------------------------------------------------------------------------

describe("parseReviewResponse", () => {
  it("parses AGREE / DISAGREE / ADD_MORE decisions", () => {
    const txt = `#1 AGREE
#2 DISAGREE — the null is already handled via optional chaining
#3 AGREE
ADD [BLOCKER] [HIGH] race condition in cache write path`;
    const { decisions, additions } = parseReviewResponse(txt);
    expect(decisions).toHaveLength(3);
    expect(decisions[0]).toMatchObject({ index: 0, stance: "AGREE" });
    expect(decisions[1]).toMatchObject({ index: 1, stance: "DISAGREE" });
    expect(decisions[1].note).toMatch(/optional chaining/);
    expect(additions).toHaveLength(1);
    expect(additions[0].kind).toBe("BLOCKER");
  });

  it("handles zero-disagreement consensus response", () => {
    const txt = `#1 AGREE\n#2 AGREE\n#3 AGREE`;
    const r = parseReviewResponse(txt);
    expect(r.decisions.every((d) => d.stance === "AGREE")).toBe(true);
    expect(r.additions).toEqual([]);
  });

  it("ignores unrelated prose between decisions", () => {
    const txt = `Thanks for the review.
#1 AGREE
Some filler.
#2 DISAGREE — false positive`;
    const r = parseReviewResponse(txt);
    expect(r.decisions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// decideNextRound — core loop control logic
// ---------------------------------------------------------------------------

describe("decideNextRound", () => {
  it("R1 with zero issues → stop + APPROVE", () => {
    const d = decideNextRound({ round: 1, issues: [] });
    expect(d).toMatchObject({ stop: true, verdict: "APPROVE" });
  });

  it("R1 with only suggestions (no blockers) → stop + COMMENT", () => {
    const d = decideNextRound({
      round: 1,
      issues: [{ kind: "SUGGESTION", confidence: "MED", text: "x" }],
    });
    expect(d).toMatchObject({ stop: true, verdict: "COMMENT" });
  });

  it("R1 with blockers → continue to R2", () => {
    const d = decideNextRound({
      round: 1,
      issues: [{ kind: "BLOCKER", confidence: "HIGH", text: "x" }],
    });
    expect(d.stop).toBe(false);
  });

  it("R2 with full consensus (no DISAGREE, no ADD) → stop", () => {
    const d = decideNextRound({
      round: 2,
      review: { decisions: [{ index: 0, stance: "AGREE" }], additions: [] },
    });
    expect(d).toMatchObject({ stop: true, reason: "consensus" });
  });

  it("R2 with DISAGREE → continue to R3", () => {
    const d = decideNextRound({
      round: 2,
      review: { decisions: [{ index: 0, stance: "DISAGREE" }], additions: [] },
    });
    expect(d.stop).toBe(false);
  });

  it("R2 with ADD_MORE → continue to R3", () => {
    const d = decideNextRound({
      round: 2,
      review: {
        decisions: [{ index: 0, stance: "AGREE" }],
        additions: [{ kind: "BLOCKER", confidence: "HIGH", text: "new one" }],
      },
    });
    expect(d.stop).toBe(false);
  });

  it("R3 always stops (max-rounds guard)", () => {
    const d = decideNextRound({ round: 3 });
    expect(d).toMatchObject({ stop: true, reason: "max-rounds" });
  });
});

// ---------------------------------------------------------------------------
// mergeConsensus + classifyConsensus + finalVerdictFrom
// ---------------------------------------------------------------------------

describe("mergeConsensus + classifyConsensus", () => {
  const issuesA = [
    { kind: "BLOCKER", confidence: "HIGH", text: "auth bypass" },
    { kind: "BLOCKER", confidence: "MED", text: "possible race" },
    { kind: "SUGGESTION", confidence: "LOW", text: "extract helper" },
  ];

  it("R2 consensus: AGREE on all → 2 blockers, 1 suggestion, APPROVE→REQUEST_CHANGES", () => {
    const reviewB = {
      decisions: [
        { index: 0, stance: "AGREE" },
        { index: 1, stance: "AGREE" },
        { index: 2, stance: "AGREE" },
      ],
      additions: [],
    };
    const merged = mergeConsensus(issuesA, reviewB);
    const cls = classifyConsensus(merged);
    expect(cls.blockers).toHaveLength(2);
    expect(cls.suggestions).toHaveLength(1);
    expect(cls.disagreements).toHaveLength(0);
    expect(finalVerdictFrom(cls, false)).toBe("REQUEST_CHANGES");
  });

  it("R2: B disagrees on one blocker — without R3 it moves to disagreements", () => {
    const reviewB = {
      decisions: [
        { index: 0, stance: "AGREE" },
        { index: 1, stance: "DISAGREE", note: "guarded by mutex" },
        { index: 2, stance: "AGREE" },
      ],
      additions: [],
    };
    const merged = mergeConsensus(issuesA, reviewB);
    const cls = classifyConsensus(merged);
    expect(cls.blockers).toHaveLength(1);
    expect(cls.disagreements).toHaveLength(1);
    expect(cls.disagreements[0].text).toMatch(/race/);
  });

  it("R3: A says KEEP on a disputed item → it survives as blocker", () => {
    const reviewB = {
      decisions: [
        { index: 0, stance: "AGREE" },
        { index: 1, stance: "DISAGREE", note: "not a real race" },
      ],
      additions: [],
    };
    const finalA = { decisions: [{ index: 1, stance: "KEEP" }] };
    const merged = mergeConsensus(issuesA.slice(0, 2), reviewB, finalA);
    const cls = classifyConsensus(merged);
    expect(cls.blockers).toHaveLength(2); // both kept
    expect(cls.disagreements).toHaveLength(0);
  });

  it("R3: A concedes DROP → blocker becomes demoted suggestion", () => {
    const reviewB = {
      decisions: [
        { index: 0, stance: "AGREE" },
        { index: 1, stance: "DISAGREE", note: "false positive" },
      ],
      additions: [],
    };
    const finalA = { decisions: [{ index: 1, stance: "DROP" }] };
    const merged = mergeConsensus(issuesA.slice(0, 2), reviewB, finalA);
    const cls = classifyConsensus(merged);
    expect(cls.blockers).toHaveLength(1);
    expect(cls.suggestions.some((s) => s.demoted)).toBe(true);
    expect(cls.disagreements).toHaveLength(0);
  });

  it("B additions are appended to the blocker list when kind=BLOCKER", () => {
    const reviewB = {
      decisions: [
        { index: 0, stance: "AGREE" },
        { index: 1, stance: "AGREE" },
        { index: 2, stance: "AGREE" },
      ],
      additions: [
        { kind: "BLOCKER", confidence: "HIGH", text: "missing input validation" },
      ],
    };
    const merged = mergeConsensus(issuesA, reviewB);
    const cls = classifyConsensus(merged);
    expect(cls.blockers).toHaveLength(3); // 2 original + 1 B-added
    expect(cls.blockers[2].text).toMatch(/input validation/);
  });

  it("non-consensus: unresolved disagreement drives REQUEST_CHANGES", () => {
    const cls = {
      blockers: [],
      suggestions: [],
      disagreements: [{ text: "???", bNote: "no" }],
    };
    expect(finalVerdictFrom(cls, true)).toBe("REQUEST_CHANGES");
  });

  it("empty classification → APPROVE", () => {
    expect(
      finalVerdictFrom({ blockers: [], suggestions: [], disagreements: [] }, false)
    ).toBe("APPROVE");
  });
});

// ---------------------------------------------------------------------------
// buildComment smoke test — output shape / flags
// ---------------------------------------------------------------------------

describe("buildComment", () => {
  it("includes the hidden machine tag and round count", () => {
    const body = buildComment({
      roundCount: 2,
      classified: { blockers: [], suggestions: [], disagreements: [] },
      nonConsensus: false,
      singleAgentFallback: false,
      agentA: "Codex",
      agentB: "Claude",
      verdict: "APPROVE",
      rawTranscript: "=== Round 1 ===\nNONE",
    });
    expect(body).toMatch(/<!-- cross-reviewer:consensus -->/);
    expect(body).toMatch(/Consensus Review \(2 rounds\)/);
    expect(body).toMatch(/Verdict: \*\*APPROVE\*\*/);
  });

  it("marks non-consensus flag when unresolved disagreements exist", () => {
    const body = buildComment({
      roundCount: 3,
      classified: {
        blockers: [{ kind: "BLOCKER", confidence: "HIGH", text: "x", stance: "AGREE" }],
        suggestions: [],
        disagreements: [{ text: "disputed", bNote: "no" }],
      },
      nonConsensus: true,
      singleAgentFallback: false,
      agentA: "Claude",
      agentB: "Codex",
      verdict: "REQUEST_CHANGES",
      rawTranscript: "…",
    });
    expect(body).toMatch(/\[non-consensus\]/);
    expect(body).toMatch(/미해결 이견 1건/);
  });

  it("marks single-agent-fallback in the header", () => {
    const body = buildComment({
      roundCount: 1,
      classified: { blockers: [], suggestions: [], disagreements: [] },
      nonConsensus: false,
      singleAgentFallback: true,
      agentA: "Codex",
      agentB: "Claude",
      verdict: "APPROVE",
      rawTranscript: "…",
    });
    expect(body).toMatch(/\[single-agent-fallback\]/);
    expect(body).toMatch(/단독 리뷰 모드/);
  });
});
