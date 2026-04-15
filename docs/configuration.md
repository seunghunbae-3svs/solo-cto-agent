# Configuration

solo-cto-agent works out of the box with zero configuration. Everything below is optional.

## Config file

Create `~/.solo-cto-agent/config.json` to customize defaults. A JSON Schema is included for editor autocompletion:

```json
{
  "$schema": "https://raw.githubusercontent.com/seunghunbae-3svs/solo-cto-agent/main/config.schema.json",
  "models": {
    "claude": "claude-sonnet-4-20250514",
    "codex": "codex-mini-latest",
    "openai": "gpt-4o"
  },
  "tierModels": {
    "claude": {
      "maker": "claude-haiku-4-5-20251001",
      "builder": "claude-sonnet-4-5-20250929",
      "cto": "claude-opus-4-5-20250929"
    }
  },
  "providers": {
    "anthropicBase": "api.anthropic.com",
    "openaiBase": "api.openai.com"
  },
  "diff": {
    "maxChunkBytes": 50000
  }
}
```

All fields are optional. Missing fields fall back to built-in defaults.

Override the config path with `SOLO_CTO_CONFIG`:

```bash
SOLO_CTO_CONFIG=~/my-config.json solo-cto-agent review
```

## Environment variables

Environment variables take precedence over config file values.

| Variable | Purpose | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required for Claude reviews | `sk-ant-...` |
| `OPENAI_API_KEY` | Required for dual-review (Codex) | `sk-...` |
| `ANTHROPIC_API_BASE` | Custom Anthropic-compatible endpoint | `localhost:11434` |
| `OPENAI_API_BASE` | Custom OpenAI-compatible endpoint | `localhost:11434` |
| `SOLO_CTO_CONFIG` | Override config file path | `~/my-config.json` |

## Using alternative LLM providers

Any OpenAI-compatible or Anthropic-compatible API server works. Set the base URL via environment variable or config file.

### Ollama (local)

```bash
# Ollama serves an OpenAI-compatible API on port 11434
export OPENAI_API_BASE="localhost:11434"
export OPENAI_API_KEY="ollama"  # Ollama ignores this but the field is required
```

### LM Studio

```bash
export OPENAI_API_BASE="localhost:1234"
export OPENAI_API_KEY="lm-studio"
```

### Groq

```bash
export OPENAI_API_BASE="api.groq.com"
export OPENAI_API_KEY="gsk_..."
```

### Custom model names

If your provider uses different model names, override them in the config file:

```json
{
  "models": {
    "openai": "llama3.1:70b"
  },
  "tierModels": {
    "claude": {
      "maker": "gemma2:9b",
      "builder": "llama3.1:70b",
      "cto": "llama3.1:70b"
    }
  }
}
```

## Diff size limits

Large diffs (monorepo changes, lock file updates) can exceed API token limits. The `diff.maxChunkBytes` setting controls auto-truncation.

Default: `50000` (50KB). Diffs exceeding this limit are truncated at the nearest line boundary with a clear warning in the review output.

To increase the limit (if your provider supports larger contexts):

```json
{
  "diff": {
    "maxChunkBytes": 100000
  }
}
```

## Cloud features (CTO tier only)

These features integrate with Anthropic's April 2026 platform updates. Both are **CTO tier only** and require explicit opt-in via config.

### Claude Code Routines

Run reviews on Anthropic's cloud infrastructure — your laptop can be closed. Routines can be triggered on a schedule, via the `/fire` API endpoint, or from GitHub webhooks.

**Cost:** Standard Claude token rates. Daily run caps by plan: Pro=5, Max=15, Team/Enterprise=25.

```json
{
  "routines": {
    "enabled": true,
    "triggerId": "trig_01ABC...",
    "schedules": [
      {
        "name": "nightly-review",
        "cron": "0 2 * * *",
        "triggerId": "trig_01ABC...",
        "text": "Nightly review of all staged changes"
      }
    ]
  }
}
```

```bash
# Fire a routine manually
solo-cto-agent routine fire --text "Deploy review for v2.1"

# List configured schedules
solo-cto-agent routine schedules

# Dry-run (preview request without sending)
solo-cto-agent routine fire --dry-run
```

Setup: Create a routine in Claude Code first ([docs](https://code.claude.com/docs/en/routines)), then copy the trigger ID to your config.

### Claude Managed Agents (Deep Review)

Managed Agents provide a sandboxed environment where Claude can actually execute code, run tests, and check types — not just read the diff. This yields higher-confidence reviews but costs more.

**Cost:** Standard Claude token rates **+ $0.08/session-hour** for active runtime. A typical 2-minute review session costs ~$0.003 in runtime.

```json
{
  "managedAgents": {
    "enabled": true,
    "model": "claude-sonnet-4-6",
    "sessionTimeoutMs": 300000
  }
}
```

```bash
# Deep review with sandboxed execution
solo-cto-agent deep-review

# Preview cost without sending
solo-cto-agent deep-review --dry-run

# JSON output
solo-cto-agent deep-review --json
```

Available models: `claude-sonnet-4-6` (default, balanced), `claude-opus-4-6` (deepest reasoning), `claude-haiku-4-5-20251001` (fastest/cheapest).

### Cost summary

| Feature | Token cost | Additional cost | Tier | Daily cap |
|---|---|---|---|---|
| `review` | Standard rates | — | All | Unlimited |
| `dual-review` | Standard rates (2 providers) | — | Builder+ | Unlimited |
| `routine fire` | Standard rates | — | CTO | Pro=5, Max=15, Team=25 |
| `deep-review` | Standard rates | $0.08/session-hour | CTO | Unlimited |

## Precedence order

For any setting, the resolution order is:

1. Environment variable (highest priority)
2. Config file (`~/.solo-cto-agent/config.json`)
3. Built-in default (lowest priority)
