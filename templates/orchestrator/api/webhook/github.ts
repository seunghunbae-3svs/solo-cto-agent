import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createHmac } from 'crypto'
import { recordResult, loadScores, checkCircuit } from '../../lib/scores'
import { sendMessage, formatBuildSuccess, formatBuildFailure, formatCircuitOpen, formatCrossReview } from '../../lib/telegram'

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || ''

function verifySignature(body: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !signature) return false
  const expected = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
  return signature === expected
}

function identifyAgent(branchName: string): 'claude' | 'codex' | null {
  if (branchName.includes('-claude')) return 'claude'
  if (branchName.includes('-codex')) return 'codex'
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  const rawBody = JSON.stringify(req.body)
  const sig = req.headers['x-hub-signature-256'] as string | undefined
  if (!verifySignature(rawBody, sig)) return res.status(401).json({ error: 'Invalid signature' })

  const event = req.headers['x-github-event'] as string
  const payload = req.body

  try {
    switch (event) {
      case 'pull_request': await handlePR(payload); break
      case 'deployment_status': await handleDeploy(payload); break
      case 'check_run': await handleCheck(payload); break
    }
    return res.status(200).json({ received: true, event })
  } catch (e) {
    console.error('[Webhook] Error:', e)
    return res.status(500).json({ error: String(e) })
  }
}

async function handlePR(payload: any) {
  const { action, pull_request: pr, repository: repo } = payload
  if (!pr || !repo) return
  const branch = pr.head.ref
  const agent = identifyAgent(branch)
  if (!agent) return

  if (action === 'opened' || action === 'reopened') {
    const data = await loadScores()
    const circuit = checkCircuit(data, agent, repo.name)
    if (circuit.open) {
      await sendMessage(`\u26a0\ufe0f <b>PR with Open Circuit</b>\n\ud83d\udce6 ${repo.name} PR #${pr.number}\n\ud83e\udd16 ${agent}: ${circuit.consecutiveFailures} failures`)
    }
    const other = agent === 'claude' ? 'codex' : 'claude'
    await sendMessage(formatCrossReview(agent, other, repo.name, pr.number))
  }
  if (action === 'closed' && pr.merged) {
    await sendMessage(`\ud83c\udf89 <b>PR Merged</b>\n\ud83d\udce6 ${repo.name} #${pr.number}\n\ud83e\udd16 ${agent}: ${pr.title}`)
  }
}

async function handleDeploy(payload: any) {
  const { deployment_status: ds, deployment, repository: repo } = payload
  if (!ds || !repo) return
  const state = ds.state
  if (state === 'pending') return
  const branch = deployment?.ref || 'unknown'
  const agent = identifyAgent(branch)
  if (agent) {
    const success = state === 'success'
    const { stats, circuitTripped } = await recordResult({
      agent, repo: repo.name, branch, success,
      buildId: ds.target_url, error: success ? undefined : `Deployment ${state}`,
      timestamp: Date.now(),
    })
    if (circuitTripped) await sendMessage(formatCircuitOpen(agent, repo.name, stats.consecutiveFailures))
  }
  if (state === 'success') await sendMessage(formatBuildSuccess(repo.name, branch, ds.target_url))
  else if (state === 'failure' || state === 'error') await sendMessage(formatBuildFailure(repo.name, branch, `Deployment ${state}`))
}

async function handleCheck(payload: any) {
  const { check_run: cr, repository: repo } = payload
  if (!cr || !repo || cr.status !== 'completed') return
  if (!cr.name?.includes('Vercel') && !cr.name?.includes('vercel')) return
  const branch = cr.check_suite?.head_branch || 'unknown'
  const agent = identifyAgent(branch)
  if (!agent) return
  const success = cr.conclusion === 'success'
  await recordResult({
    agent, repo: repo.name, branch, success,
    error: success ? undefined : `Check: ${cr.conclusion}`,
    timestamp: Date.now(),
  })
                                                                           }
