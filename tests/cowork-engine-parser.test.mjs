import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const engine = require("../bin/cowork-engine.js");

describe("cowork-engine: parseReviewResponse", () => {
  it("normalizes APPROVE verdict (English)", () => {
    const text = `[VERDICT] APPROVE\n\n[ISSUES]\n\n[SUMMARY]\nLooks good.`;
    const r = engine.parseReviewResponse(text);
    expect(r.verdict).toBe("APPROVE");
    expect(r.verdictKo).toBe("승인");
  });

  it("normalizes REQUEST_CHANGES verdict (English)", () => {
    const text = `[VERDICT] REQUEST_CHANGES\n[SUMMARY]\nFix the bug.`;
    const r = engine.parseReviewResponse(text);
    expect(r.verdict).toBe("REQUEST_CHANGES");
    expect(r.verdictKo).toBe("수정요청");
  });

  it("normalizes legacy CHANGES_REQUESTED to REQUEST_CHANGES", () => {
    const text = `[VERDICT] CHANGES_REQUESTED\n[SUMMARY]\nbla`;
    const r = engine.parseReviewResponse(text);
    expect(r.verdict).toBe("REQUEST_CHANGES");
  });

  it("normalizes Korean 수정요청", () => {
    const text = `[VERDICT] 수정요청\n[SUMMARY]\n버그 수정 필요.`;
    const r = engine.parseReviewResponse(text);
    expect(r.verdict).toBe("REQUEST_CHANGES");
  });

  it("normalizes Korean 승인", () => {
    const text = `[VERDICT] 승인\n[SUMMARY]\nOK`;
    const r = engine.parseReviewResponse(text);
    expect(r.verdict).toBe("APPROVE");
  });

  it("parses BLOCKER / SUGGESTION / NIT issues", () => {
    const text = `[VERDICT] REQUEST_CHANGES

[ISSUES]
⛔ [src/auth.ts:42]
  타입 any 사용
  → 구체 타입 지정

⚠️ [src/api.ts:17]
  try-catch 누락
  → 에러 핸들링 추가

💡 [src/util.ts:3]
  import 경로 상대경로
  → @/ 로 변경

[SUMMARY]
타입 + 에러 처리 두 곳 막힘.`;

    const r = engine.parseReviewResponse(text);
    expect(r.issues.length).toBe(3);
    expect(r.issues[0].severity).toBe("BLOCKER");
    expect(r.issues[1].severity).toBe("SUGGESTION");
    expect(r.issues[2].severity).toBe("NIT");
    expect(r.issues[0].location).toBe("src/auth.ts:42");
    expect(r.summary).toContain("막힘");
  });

  it("captures NEXT ACTION block", () => {
    const text = `[VERDICT] REQUEST_CHANGES

[SUMMARY]
한 줄.

[NEXT ACTION]
- 항목 1
- 항목 2`;
    const r = engine.parseReviewResponse(text);
    expect(r.nextAction).toContain("항목 1");
    expect(r.nextAction).toContain("항목 2");
  });

  it("defaults to COMMENT when no verdict found", () => {
    const r = engine.parseReviewResponse(`hello world no verdict here`);
    expect(r.verdict).toBe("COMMENT");
    expect(r.verdictKo).toBe("보류");
  });
});
