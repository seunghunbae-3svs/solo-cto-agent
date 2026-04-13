export interface AgentScore {
  agent: 'claude' | 'codex'
  repo: string
  branch: string
  success: boolean
  buildId?: string
  timestamp: number
  error?: string
  commitSha?: string
}

export interface AgentStats {
  agent: 'claude' | 'codex'
  totalTasks: number
  successes: number
  failures: number
  consecutiveFailures: number
  lastSuccess?: number
  lastFailure?: number
  successRate: number
  circuitOpen: boolean
}

export interface CircuitBreakerState {
  agent: 'claude' | 'codex'
  repo: string
  consecutiveFailures: number
  lastFailureTime: number
  open: boolean
  reason?: string
}

export interface ScoreFile {
  lastUpdated: number
  scores: AgentScore[]
  circuits: Record<string, CircuitBreakerState>
}

export const CIRCUIT_MAX_FAILURES = 3
export const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000 // 30 minutes

export const PRODUCT_REPOS = [
  '{{PRODUCT_REPO_4}}',
  '{{PRODUCT_REPO_2}}',
  '{{PRODUCT_REPO_1}}',
  '{{PRODUCT_REPO_3}}',
  '{{PRODUCT_REPO_5}}',
] as const

export type ProductRepo = (typeof PRODUCT_REPOS)[number]
