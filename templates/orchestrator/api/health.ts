import type { VercelRequest, VercelResponse } from '@vercel/node'
import { loadScores, computeStats, checkCircuit } from '../lib/scores'
import { PRODUCT_REPOS } from '../lib/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const data = await loadScores()
    const claudeStats = computeStats(data, 'claude')
    const codexStats = computeStats(data, 'codex')

    const circuits: Record<string, { open: boolean; failures: number; reason?: string }> = {}
    for (const repo of PRODUCT_REPOS) {
      for (const agent of ['claude', 'codex'] as const) {
        const state = checkCircuit(data, agent, repo)
        if (state.consecutiveFailures > 0) {
          circuits[`${agent}:${repo}`] = {
            open: state.open,
            failures: state.consecutiveFailures,
            reason: state.reason,
          }
        }
      }
    }

    return res.status(200).json({
      status: 'ok',
      timestamp: Date.now(),
      agents: { claude: claudeStats, codex: codexStats },
      circuits,
      totalScores: data.scores.length,
    })
  } catch (e) {
    return res.status(500).json({ status: 'error', error: String(e) })
  }
      }
