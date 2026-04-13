import type { AgentScore, AgentStats, ScoreFile, CircuitBreakerState } from './types'
import { CIRCUIT_MAX_FAILURES, CIRCUIT_COOLDOWN_MS } from './types'

let cache: ScoreFile | null = null
let cacheTime = 0
const CACHE_TTL_MS = 60_000

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const REPO_OWNER = 'seunghunbae-3svs'
const REPO_NAME = 'dual-agent-review-orchestrator'
const SCORE_FILE_PATH = 'agent-scores.json'

async function githubFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
}

export async function loadScores(): Promise<ScoreFile> {
  if (cache && Date.now() - cacheTime < CACHE_TTL_MS) return cache
  try {
    const res = await githubFetch(SCORE_FILE_PATH)
    if (res.ok) {
      const data = await res.json() as { content: string; sha: string }
      const decoded = Buffer.from(data.content, 'base64').toString('utf8')
      cache = JSON.parse(decoded) as ScoreFile
      ;(cache as ScoreFile & { _sha: string })._sha = data.sha
    } else {
      cache = { lastUpdated: Date.now(), scores: [], circuits: {} }
    }
  } catch {
    cache = cache || { lastUpdated: Date.now(), scores: [], circuits: {} }
  }
  cacheTime = Date.now()
  return cache!
}

export async function saveScores(data: ScoreFile): Promise<boolean> {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64')
  const sha = (data as ScoreFile & { _sha?: string })._sha
  try {
    const res = await githubFetch(SCORE_FILE_PATH, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'chore: update agent scores [skip ci]',
        content,
        ...(sha ? { sha } : {}),
      }),
    })
    if (res.ok) {
      const result = await res.json() as { content: { sha: string } }
      ;(data as ScoreFile & { _sha: string })._sha = result.content.sha
      cache = data
      cacheTime = Date.now()
      return true
    }
    console.error('[Scores] Save failed:', res.status)
    return false
  } catch (e) {
    console.error('[Scores] Save error:', e)
    return false
  }
}

export async function recordResult(score: AgentScore): Promise<{ stats: AgentStats; circuitTripped: boolean }> {
  const data = await loadScores()
  data.scores.push(score)
  data.lastUpdated = Date.now()

  const circuitKey = `${score.agent}:${score.repo}`
  const circuit = data.circuits[circuitKey] || {
    agent: score.agent,
    repo: score.repo,
    consecutiveFailures: 0,
    lastFailureTime: 0,
    open: false,
  }

  let circuitTripped = false
  if (score.success) {
    circuit.consecutiveFailures = 0
    circuit.open = false
    circuit.reason = undefined
  } else {
    circuit.consecutiveFailures++
    circuit.lastFailureTime = Date.now()
    if (circuit.consecutiveFailures >= CIRCUIT_MAX_FAILURES) {
      circuit.open = true
      circuit.reason = `${circuit.consecutiveFailures} consecutive failures on ${score.repo}`
      circuitTripped = true
    }
  }
  data.circuits[circuitKey] = circuit

  if (data.scores.length > 200) {
    data.scores = data.scores.slice(-200)
  }

  await saveScores(data)
  return { stats: computeStats(data, score.agent), circuitTripped }
}

export function computeStats(data: ScoreFile, agent: 'claude' | 'codex'): AgentStats {
  const agentScores = data.scores.filter(s => s.agent === agent)
  const successes = agentScores.filter(s => s.success).length
  const failures = agentScores.filter(s => !s.success).length
  const total = agentScores.length

  let consecutiveFailures = 0
  for (let i = agentScores.length - 1; i >= 0; i--) {
    if (!agentScores[i].success) consecutiveFailures++
    else break
  }

  const lastSuccess = agentScores.filter(s => s.success).pop()?.timestamp
  const lastFailure = agentScores.filter(s => !s.success).pop()?.timestamp

  const circuitOpen = Object.values(data.circuits).some(
    c => c.agent === agent && c.open && (Date.now() - c.lastFailureTime < CIRCUIT_COOLDOWN_MS)
  )

  return {
    agent, totalTasks: total, successes, failures, consecutiveFailures,
    lastSuccess, lastFailure,
    successRate: total > 0 ? successes / total : 0,
    circuitOpen,
  }
}

export function checkCircuit(data: ScoreFile, agent: 'claude' | 'codex', repo: string): CircuitBreakerState {
  const key = `${agent}:${repo}`
  const circuit = data.circuits[key]
  if (!circuit) {
    return { agent, repo, consecutiveFailures: 0, lastFailureTime: 0, open: false }
  }
  if (circuit.open && Date.now() - circuit.lastFailureTime >= CIRCUIT_COOLDOWN_MS) {
    circuit.open = false
    circuit.reason = 'Auto-reset after cooldown'
  }
  return circuit
      }
