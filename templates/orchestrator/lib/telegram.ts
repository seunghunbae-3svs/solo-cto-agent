const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || ''

export async function sendMessage(text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('[Telegram] Missing BOT_TOKEN or CHAT_ID')
    return false
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error(`[Telegram] Error ${res.status}: ${err}`)
      return false
    }
    return true
  } catch (e) {
    console.error('[Telegram] Send failed:', e)
    return false
  }
}

export function formatBuildSuccess(repo: string, branch: string, url?: string): string {
  return `✅ <b>Build Success</b>\n📦 ${repo} / ${branch}${url ? `\n🔗 ${url}` : ''}`
}

export function formatBuildFailure(repo: string, branch: string, error?: string): string {
  return `❌ <b>Build Failed</b>\n📦 ${repo} / ${branch}${error ? `\n⚠️ ${error}` : ''}`
}

export function formatCircuitOpen(agent: string, repo: string, failures: number): string {
  return `🔴 <b>Circuit Breaker OPEN</b>\n🤖 ${agent} blocked on ${repo}\n💥 ${failures} consecutive failures\n⏳ Cooldown: 30 min`
}

export function formatCrossReview(fromAgent: string, toAgent: string, repo: string, prNumber: number): string {
  return `🔄 <b>Cross-Review Assigned</b>\n📦 ${repo} PR #${prNumber}\n🤖 ${fromAgent} → ${toAgent} review`
}

export function formatDailySummary(stats: { claude: { total: number; rate: number; circuit: boolean }; codex: { total: number; rate: number; circuit: boolean } }): string {
  return [
    `📊 <b>Daily Agent Summary</b>`,
    ``,
    `🟣 Claude: ${stats.claude.total} tasks, ${(stats.claude.rate * 100).toFixed(0)}% success${stats.claude.circuit ? ' 🔴 BLOCKED' : ' 🟢'}`,
    `🟠 Codex: ${stats.codex.total} tasks, ${(stats.codex.rate * 100).toFixed(0)}% success${stats.codex.circuit ? ' 🔴 BLOCKED' : ' 🟢'}`,
  ].join('\n')
        }
