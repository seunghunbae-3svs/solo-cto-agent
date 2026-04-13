import type { VercelRequest, VercelResponse } from '@vercel/node'
import { loadScores, recordResult, computeStats } from '../../lib/scores'
import { sendMessage, formatBuildSuccess, formatBuildFailure, formatCircuitOpen } from '../../lib/telegram'
import type { AgentScore } from '../../lib/types'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    try {
      const data = await loadScores()
      return res.status(200).json({
        lastUpdated: data.lastUpdated,
        totalScores: data.scores.length,
        scores: data.scores.slice(-50),
        agents: {
          claude: computeStats(data, 'claude'),
          codex: computeStats(data, 'codex'),
        },
        circuits: data.circuits,
      })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  if (req.method === 'POST') {
    try {
      const { agent, repo, branch, success, buildId, error, commitSha } = req.body as Partial<AgentScore>
      if (!agent || !repo || !branch || typeof success !== 'boolean') {
        return res.status(400).json({ error: 'Missing required fields: agent, repo, branch, success' })
      }
      if (agent !== 'claude' && agent !== 'codex') {
        return res.status(400).json({ error: 'agent must be "claude" or "codex"' })
      }

      const score: AgentScore = { agent, repo, branch, success, buildId, error, commitSha, timestamp: Date.now() }
      const { stats, circuitTripped } = await recordResult(score)

      if (success) await sendMessage(formatBuildSuccess(repo, branch, buildId))
      else await sendMessage(formatBuildFailure(repo, branch, error))
      if (circuitTripped) await sendMessage(formatCircuitOpen(agent, repo, stats.consecutiveFailures))

      return res.status(200).json({ recorded: true, stats, circuitTripped })
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
        }
