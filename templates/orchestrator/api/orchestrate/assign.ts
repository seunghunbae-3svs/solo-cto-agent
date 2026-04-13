import type { VercelRequest, VercelResponse } from '@vercel/node'
import { loadScores, computeStats, checkCircuit } from '../../lib/scores'
import { sendMessage } from '../../lib/telegram'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' })
  }

  const { repo, task, preferredAgent } = req.body as {
    repo: string
    task: string
    preferredAgent?: 'claude' | 'codex'
  }

  if (!repo || !task) {
    return res.status(400).json({ error: 'Missing required fields: repo, task' })
  }

  try {
    const data = await loadScores()

    const claudeCircuit = checkCircuit(data, 'claude', repo)
    const codexCircuit = checkCircuit(data, 'codex', repo)
    const claudeStats = computeStats(data, 'claude')
    const codexStats = computeStats(data, 'codex')

    let assignedAgent: 'claude' | 'codex'
    let reasoning: string

    // Decision logic
    if (claudeCircuit.open && codexCircuit.open) {
      // Both circuits open — pick the one closer to cooldown reset
      const claudeRemaining = (claudeCircuit.lastFailureTime + 30 * 60 * 1000) - Date.now()
      const codexRemaining = (codexCircuit.lastFailureTime + 30 * 60 * 1000) - Date.now()
      assignedAgent = claudeRemaining < codexRemaining ? 'claude' : 'codex'
      reasoning = `Both circuits open. ${assignedAgent} cooldown expires sooner (${Math.round(Math.min(claudeRemaining, codexRemaining) / 60000)}min)`
    } else if (claudeCircuit.open) {
      assignedAgent = 'codex'
      reasoning = `Claude circuit open (${claudeCircuit.consecutiveFailures} failures). Routing to Codex.`
    } else if (codexCircuit.open) {
      assignedAgent = 'claude'
      reasoning = `Codex circuit open (${codexCircuit.consecutiveFailures} failures). Routing to Claude.`
    } else if (preferredAgent) {
      assignedAgent = preferredAgent
      reasoning = `User preferred ${preferredAgent}. Both circuits closed.`
    } else {
      // Pick agent with higher success rate, tiebreak on total tasks (less = less busy)
      if (claudeStats.successRate > codexStats.successRate) {
        assignedAgent = 'claude'
        reasoning = `Claude has higher success rate (${(claudeStats.successRate * 100).toFixed(0)}% vs ${(codexStats.successRate * 100).toFixed(0)}%)`
      } else if (codexStats.successRate > claudeStats.successRate) {
        assignedAgent = 'codex'
        reasoning = `Codex has higher success rate (${(codexStats.successRate * 100).toFixed(0)}% vs ${(claudeStats.successRate * 100).toFixed(0)}%)`
      } else {
        // Equal rate — pick the less busy one
        assignedAgent = claudeStats.totalTasks <= codexStats.totalTasks ? 'claude' : 'codex'
        reasoning = `Equal success rates. ${assignedAgent} has fewer total tasks.`
      }
    }

    await sendMessage(
      `\u{1F3AF} <b>Task Assigned</b>\n` +
      `\u{1F4E6} ${repo}\n` +
      `\u{1F916} \u2192 ${assignedAgent}\n` +
      `\u{1F4DD} ${task.substring(0, 100)}\n` +
      `\u{1F4A1} ${reasoning}`
    )

    return res.status(200).json({
      assignedAgent,
      reasoning,
      circuits: { claude: claudeCircuit, codex: codexCircuit },
      stats: { claude: claudeStats, codex: codexStats },
    })
  } catch (e) {
    return res.status(500).json({ error: String(e) })
  }
    }
