# Telegram Decision Card — 3-tier 스펙

SKILL.md §6의 "의사결정 카드"를 Telegram으로 발송하는 스펙. `ops/orchestrator/decision-message.js`가 이 포맷을 구현한다.

---

## 0. 왜 3-tier인가

한 메시지에 모든 정보를 넣으면 모바일에서 스크롤 지옥. Telegram 특성 + 운영 경험:

| Tier | 목적 | 한계 |
|---|---|---|
| T1 — Summary | 30초 안에 머지 여부 판단 | 400자 이내 |
| T2 — Detail | 구체 이슈 + 리뷰어 근거 | 2000자 이내 |
| T3 — Drilldown | diff 링크, preview, 스코어 변화 | 별도 메시지 (사진 포함 가능) |

---

## 1. T1 — Summary 카드

inline keyboard로 MERGE / REWORK / REJECT 버튼 제공.

```
🤖 *<repo>* #<pr>
<title>

✅/⚠️/⛔ *<VERDICT>*
author=<a> · reviewer=<b>

<한 줄 요약> [확정]/[추정]

⚡ <issues_summary>
예: "1 BLOCKER · 2 SUG · 3 NIT" 또는 "clean"

─────────
[ MERGE ] [ REWORK ] [ REJECT ]
[ DETAIL ] [ PREVIEW ]
```

inline_keyboard JSON:

```json
{
  "inline_keyboard": [
    [
      { "text": "✅ MERGE", "callback_data": "merge:{{REPO}}:{{PR}}" },
      { "text": "🔁 REWORK", "callback_data": "rework:{{REPO}}:{{PR}}" },
      { "text": "❌ REJECT", "callback_data": "reject:{{REPO}}:{{PR}}" }
    ],
    [
      { "text": "📄 Detail (T2)", "callback_data": "detail:{{REPO}}:{{PR}}" },
      { "text": "🌐 Preview", "url": "{{PREVIEW_URL}}" }
    ]
  ]
}
```

---

## 2. T2 — Detail 카드

T1 버튼에서 "Detail" 클릭 시 새 메시지로 발송.

```
📋 *Review Detail* — <repo>#<pr>

*Author (<agent_a>)*
<요약 2–3줄. 변경 의도 + 영향 범위 + 테스트 결과>
[확정] tests: 8/8 pass
[추정] impact: 12 files downstream

*Reviewer (<agent_b>) — <VERDICT>*

⛔ *BLOCKER*
· `lib/tax.ts:88` null-guard 제거됨 — prod crash 가능

⚠️ *SUGGESTION*
· `lib/tax.ts:134` any 타입 잔존
· `lib/tax.ts:201` console.log 프로덕션에 남음

💡 *NIT*
· 함수명 `calc` → `computeLineItemTax`
· 주석 JSDoc 스타일 통일
· 변수명 약어 (`i`, `j`) 풀어쓰기

*NEXT*
- 88번 복원 후 rework
- 나머지는 선택 적용

─────────
[ T3 Drilldown ] [ Close ]
```

---

## 3. T3 — Drilldown

코드 diff 발췌, 스크린샷, 스코어 변화 타임라인.

```
🔬 *Drilldown* — <repo>#<pr>

*Scores (before → after this PR)*
```
claude  0.81  →  0.82  (+0.01)
codex   0.72  →  0.69  (-0.03)  ← 이번 BLOCKER 반영
```

*Diff Hotspot* — `lib/tax.ts:85-92`
```ts
- if (!taxableAmount || taxableAmount < 0) {
-   return { vat: 0, total: 0 };
- }
  const vat = taxableAmount * rate;
  return { vat, total: taxableAmount + vat };
```
→ null·negative guard 제거. REQUEST_CHANGES의 근거.

*CI Runs*
· build: ✅ pass (37s)
· test: ✅ pass (1m12s)
· lint: ⚠️ 2 warnings

*Preview Screenshot*
[사진 1장, Playwright으로 캡처된 homepage]

*Circuit Breaker*
L1: ISSUE_OK (0 failures this issue)
L2 codex: failure_rate 24h = 22%
L2 claude: failure_rate 24h = 8%
```

Drilldown은 옵션. 요청 시에만 생성 (토큰 비용 이유).

---

## 4. Callback 처리

Telegram bot이 callback_data 수신 시 아래 흐름:

```
merge:{{REPO}}:{{PR}}   → gh pr merge <pr> --merge
                          agent-score-update.yml trigger
                          T1 카드 편집: 버튼 제거, ✅ Merged by @user 표시

rework:{{REPO}}:{{PR}}  → rework-auto.yml trigger
                          gh issue edit + label rework
                          T1 카드 편집: "🔁 Rework requested"

reject:{{REPO}}:{{PR}}  → gh pr close <pr>
                          codex/claude에 페널티 -0.05
                          T1 카드 편집: "❌ Rejected by @user"

detail:{{REPO}}:{{PR}}  → T2 카드 send (새 메시지)
```

callback 처리 후 T1 카드는 반드시 editMessageText로 **버튼 제거** (중복 클릭 방지).

---

## 5. 실패·타임아웃 처리

| 상황 | 처리 |
|---|---|
| Telegram API 5xx | 30s 후 재시도 3회 |
| Chat not found | 로그 + Slack fallback 없으면 GitHub issue 생성 |
| Callback 처리 중 gh 명령 실패 | T1 카드에 ⚠️ "merge failed, retry with `/orchestrate merge <pr>`" |
| 버튼 응답 없음 (30분) | reminder 메시지 1회, 그 후 자동 skip |

---

## 6. Markdown 이스케이프

Telegram `parse_mode: MarkdownV2` 사용 시 아래 문자는 반드시 escape:

```
_ * [ ] ( ) ~ ` > # + - = | { } . !
```

`ops/orchestrator/decision-message.js`의 `escapeMarkdown()` 사용. 직접 문자열 조립 금지.

---

## 7. 예시 — 실제 배포된 메시지

```
🤖 *tribo-store* #17
tax-policy refactor

⛔ *REQUEST_CHANGES* (수정요청)
author=codex · reviewer=claude

3개 함수 시그니처 변경. [확정] 기존 테스트 8/8 통과하지만 null-guard 제거로 prod crash 가능성 [추정].

⚡ 1 BLOCKER · 1 SUG · 1 NIT

─────────
[ ✅ MERGE ] [ 🔁 REWORK ] [ ❌ REJECT ]
[ 📄 Detail ] [ 🌐 Preview ]
```

운영자가 `🔁 REWORK` 클릭 → T1 카드 "🔁 Rework requested by @founder" 로 편집, rework-auto.yml 트리거, 새 PR 오픈 시 다시 T1 발송.
