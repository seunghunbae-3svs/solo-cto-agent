const TOKEN = process.env.ORCHESTRATOR_PAT || process.env.GITHUB_TOKEN;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const OWNER = "seunghunbae-3svs";
const ORCH_REPO = "dual-agent-review-orchestrator";

const CHECKS = [
  {
    id: "tribo-login",
    repo: "tribo-store",
    url: "https://tribo-store.vercel.app/admin/login",
    expect: ["Tribo Admin", "Sign in"],
    title: "로그인 박스/화면 이상",
  },
  {
    id: "tribo-seller",
    repo: "tribo-store",
    url: "https://tribo-store.vercel.app/s/beauty-by-kim",
    expect: ["Products", "Track Order"],
    title: "셀러 페이지 접근 불가",
  },
  {
    id: "golf-home",
    repo: "golf-now",
    url: "https://golf-now.vercel.app",
    expect: [],
    title: "홈 화면 접근 불가",
  },
  {
    id: "palate-home",
    repo: "palate-pilot",
    url: "https://palate-pilot.vercel.app",
    expect: [],
    title: "홈 화면 접근 불가",
  },
  {
    id: "eventbadge-home",
    repo: "eventbadge",
    url: "https://eventbadge.vercel.app",
    expect: [],
    title: "홈 화면 접근 불가",
  },
  {
    id: "3stripe-home",
    repo: "3stripe-event",
    url: "https://3stripe-event.vercel.app",
    expect: [],
    title: "홈 화면 접근 불가",
  },
];

async function gh(endpoint, method = "GET", body = null) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "orchestrator-auto-diagnose",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text }),
  });
}

async function fetchCheck(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: String(err?.message || "fetch_failed") };
  } finally {
    clearTimeout(timer);
  }
}

function htmlLooksBroken(text, expect = []) {
  const lower = String(text || "").toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) return true;
  if (!expect.length) return false;
  return !expect.every((token) => lower.includes(token.toLowerCase()));
}

async function issueExists(id) {
  const query = `repo:${OWNER}/${ORCH_REPO} is:issue is:open "auto-diagnose:id=${id}"`;
  const res = await gh(`/search/issues?q=${encodeURIComponent(query)}`);
  return (res?.total_count || 0) > 0;
}

async function createIssue(check, reason) {
  const body = [
    `## 자동 진단 이슈`,
    `- Repo: ${check.repo}`,
    `- URL: ${check.url}`,
    `- Reason: ${reason}`,
    ``,
    `### 다음 액션`,
    `- 원인 확인 후 수정`,
    `- 수정 후 재검증`,
    ``,
    `<!-- auto-diagnose:id=${check.id} -->`,
  ].join("\n");

  await gh(`/repos/${OWNER}/${ORCH_REPO}/issues`, "POST", {
    title: `[auto] ${check.repo}: ${check.title}`,
    body,
    labels: ["agent-codex", "agent-claude", "dual-review"],
  });
}

async function main() {
  if (!TOKEN) throw new Error("Missing GitHub token");

  const failures = [];

  for (const check of CHECKS) {
    const result = await fetchCheck(check.url);
    const broken = !result.ok || htmlLooksBroken(result.text, check.expect);
    if (broken) {
      failures.push({ check, result });
      const exists = await issueExists(check.id);
      if (!exists) {
        const reason = result.status
          ? `status ${result.status}`
          : `fetch failed: ${result.text}`;
        await createIssue(check, reason);
      }
    }
  }

  if (failures.length && process.env.AUTO_DIAGNOSE_NOTIFY === "true") {
    const lines = failures.map((f) => `- ${f.check.repo}: ${f.check.title} (${f.check.url})`);
    await sendTelegram(`🚨 자동 진단 이슈 감지\n${lines.join("\n")}`);
  }
}

main().catch(async (err) => {
  console.error(err);
  if (process.env.AUTO_DIAGNOSE_NOTIFY === "true") {
    await sendTelegram(`❌ 자동 진단 실패: ${err.message}`).catch(() => {});
  }
  process.exit(1);
});
