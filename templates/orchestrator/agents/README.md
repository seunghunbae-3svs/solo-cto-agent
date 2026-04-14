# Agent Specifications (Source of Truth)

This directory holds **agent-agnostic** role specifications. They are written once and referenced by runtime-specific adapters.

## Layout

```
agents/                     ← single source of truth (this directory)
├── implementer.md          ← role: build the fix for an issue
├── integrator.md           ← role: merge two candidate implementations
└── reviewer.md             ← role: review a sibling agent's PR

.claude/agents/             ← Claude Code adapters (short)
├── implementer.md          ← "follow ../../agents/implementer.md" + Claude-specific overrides
├── integrator.md
└── reviewer.md

.codex/prompts/             ← Codex CLI adapters (short)
├── implement.md            ← "follow ../../agents/implementer.md" + Codex-specific overrides
├── integrate.md
└── review.md
```

## Why

Before PR-G3, the role body was duplicated in `.claude/agents/*.md` and `.codex/prompts/*.md`. Every rule change required editing both copies, which drifted over time. Now:

- **Spec changes** → edit only `agents/<role>.md`
- **Runtime-specific tweaks** (branch naming suffix, output format hints) → edit the adapter in `.claude/agents/` or `.codex/prompts/`

## Naming convention per runtime

| Runtime | Adapter directory | Branch suffix | File extension convention |
|---|---|---|---|
| Claude Code subagent | `.claude/agents/` | `-claude` | `<role>.md` |
| Codex CLI prompt | `.codex/prompts/` | `-codex` | `<verb>.md` (e.g. `implement.md`) |

## Adapter rules

1. Adapters must include a reference to the canonical spec (`../../agents/<role>.md`).
2. Adapters should only contain runtime-specific deltas — never re-declare rules that already live in the spec.
3. If a rule diverges between runtimes, put the divergence in the adapter and note it in the spec under "Runtime overrides allowed".
