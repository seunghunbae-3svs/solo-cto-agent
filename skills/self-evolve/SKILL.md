---
name: self-evolve
description: "Continuous improvement engine for solo-cto-agent. Collects error patterns, analyzes quality, auto-improves skills, scouts new capabilities, and generates weekly reports. Activates on: self-evolve, quality check, error pattern, skill improvement, weekly report, feedback score, trending, scouting."
user-invocable: true
---

# Self-Evolve — Continuous Improvement Engine

> The system that makes the system better.
> Every error is a lesson. Every feedback is a signal. Every week, the toolkit gets smarter.

Self-evolve closes the loop between usage and improvement. Instead of static skills that decay, this engine ensures your solo-cto-agent installation learns from every session.

---

## Architecture

```
bin/self-evolve.js               ← Public module API
bin/self-evolve/
├── self-evolve-orchestrator.js  ← Master orchestrator (full cycle management)
├── error-collector.js           ← Error pattern tracking → error-patterns.md
├── quality-analyzer.js          ← Post-task quality checks → quality-log.md
├── skill-improver.js            ← 3-strike auto-patch → skill-changelog.md
├── feedback-collector.js        ← L1 user feedback (1-5) → feedback-log.md
├── weekly-report.js             ← Weekly synthesis → reports/weekly-*.md
├── skill-scout.js               ← Skill discovery & compatibility check
└── external-trends.js           ← L3 npm/GitHub/API trends → reports/trends-*.md
```

## Data Files

All markdown-based. No database required. Lives in your project directory.

```
{project}/
├── error-patterns.md      ← Error pattern registry (auto-appended)
├── quality-log.md         ← Quality check records (auto-appended)
├── skill-changelog.md     ← Skill modification history
├── feedback-log.md        ← User satisfaction scores (L1)
├── reports/
│   ├── weekly-*.md        ← Weekly synthesis reports
│   └── trends-*.md        ← External trends reports (L3)
└── memory/
    ├── index.md           ← Episode search index
    ├── episodes/          ← Session episodes (14-day retention)
    └── knowledge/         ← Auto-generated knowledge articles (permanent)
```

---

## CLI Commands

### Initialize
```bash
solo-cto-agent self-evolve init          # Create all data files & directories
solo-cto-agent self-evolve status        # System health check
```

### Error Tracking
```bash
# Record an error
solo-cto-agent self-evolve error \
  --skill review --category build \
  --symptom "TypeScript strict mode failure" \
  --cause "Missing type annotation" \
  --fix "Added explicit return type" \
  --severity medium

# View top repeated errors
solo-cto-agent self-evolve errors --top 10
```

### Quality Analysis
```bash
# Record quality check results
solo-cto-agent self-evolve quality \
  --type code --skill review \
  --checks "build:pass,typescript:pass,imports:warn"

# View quality trends + feedback summary
solo-cto-agent self-evolve summary
```

### User Feedback (L1)
```bash
# Record satisfaction score (1-5)
solo-cto-agent self-evolve feedback \
  --skill review --score 4 \
  --task "PR code review" \
  --reason "Caught the N+1 query"
```

### Skill Improvement
```bash
# Check for pending improvement triggers
solo-cto-agent self-evolve improve

# Apply all pending improvements
solo-cto-agent self-evolve improve --apply
```

### Reports
```bash
# Weekly synthesis report
solo-cto-agent self-evolve report [--weeks 2]

# External trends (npm outdated + GitHub trending)
solo-cto-agent self-evolve trends --npm-dir /path/to/project
```

### Skill Scouting
```bash
# List installed skills
solo-cto-agent self-evolve scout --installed
```

---

## How It Works

### 1. Error Pattern Collection

Every time an error occurs during a task, it gets recorded in `error-patterns.md` with a structured format:

```markdown
### [2025-04-15] Error ID: E-1
- **skill**: review
- **category**: build
- **severity**: high
- **symptom**: ReferenceError: COLORS is not defined
- **root cause**: Sub-module extraction missed constant delegation
- **fix**: Added const COLORS = reviewParser.COLORS
- **repeat count**: 1
- **needs skill improvement**: no
```

**Duplicate detection**: If the same skill + similar symptom (>60% word overlap) is recorded again, the existing entry's repeat count increments instead of creating a duplicate.

**Circuit breaker**: When an error pattern hits **3 repeats**, it triggers the skill improvement engine.

### 2. Quality Analysis

After each significant task, quality checks run against type-specific checklists:

| Type | Checks |
|------|--------|
| **code** | build-success, typescript-strict, no-console-log, import-accuracy, deployable, error-handling |
| **design** | anti-ai-slop, 8px-grid, color-tokens, mobile-responsive, accessibility, consistent-spacing |
| **document** | fact-tags, source-citations, no-exaggeration, actionable-next-steps, correct-format |
| **analysis** | fact-tags, source-citations, data-backed, risk-first, actionable-next-steps |

Results scored as `pass`, `warn`, or `fail`. Same type/skill hitting warn/fail **3 times** triggers skill improvement.

### 3. Skill Auto-Improvement (3-Strike Rule)

When triggers fire (from errors or quality), the engine:
1. Scans error-patterns + quality-log + feedback-log for the specific skill
2. Generates a prevention rule or checklist reinforcement
3. Appends it to the skill's SKILL.md under "Auto-Improvements" section
4. Records the change in skill-changelog.md
5. Reports to the user (Level 2: do first, report after)

**Protected areas**: Core philosophy sections, routing tables, and cross-skill dependencies are never auto-modified.

### 4. L1/L2 Feedback Loop

**L1**: After significant tasks, collect a 1-5 satisfaction score.
- 5 = Perfect, use as-is
- 4 = Good, minor tweaks
- 3 = Okay, room for improvement
- 2 = Poor, major rework needed
- 1 = Unusable

**L2**: When the same skill gets ≤2 score **3 times**, the engine auto-diagnoses and patches the skill based on accumulated feedback reasons.

### 5. Weekly Report

Generated on Monday mornings (or on demand). Synthesizes:
- Project activity overview
- Skill changes made
- Quality pass/warn/fail trends
- User feedback averages
- Top repeated errors
- Skill scouting findings
- Next week priorities

### 6. External Trends (L3)

Scans three sources for updates relevant to your stack:
1. **npm outdated** — Dependency update check (major vs minor)
2. **GitHub trending** — Repos matching your tech stack keywords
3. **API changelogs** — Breaking changes, new features, model updates

### 7. Skill Scouting

Discovers new skills and evaluates them against your setup:
- **Conflict detection**: Name overlap, description overlap with installed skills
- **Compatibility check**: Filters by your tech stack keywords
- **Action classification**: auto-install (system improvements) vs recommend (new capabilities)
- **Protection rules**: Never installs 2+ skills at once, never overwrites custom rules

---

## Module API

```javascript
const selfEvolve = require('solo-cto-agent/bin/self-evolve');

// Error tracking
selfEvolve.collectError(projectDir, { skill, category, symptom, cause, fix, severity });
selfEvolve.getTopErrors(projectDir, 10);
selfEvolve.getImprovementTriggers(projectDir, 3);

// Quality
selfEvolve.analyzeQuality(projectDir, { type, skill, checks, notes });
selfEvolve.getQualityTrend(projectDir, 20);

// Feedback
selfEvolve.recordSatisfaction(projectDir, { skill, score, task, reason });
selfEvolve.getLowScorePatterns(projectDir, 3);
selfEvolve.getFeedbackSummary(projectDir);

// Improvement
selfEvolve.checkTriggers(projectDir);
selfEvolve.applyImprovement(skillsDir, trigger, projectDir);

// Reports
selfEvolve.generateWeeklyReport(projectDir, { weeks: 1 });
selfEvolve.generateTrendsReport(projectDir, { npmOutdated, trending });

// Scouting
selfEvolve.getInstalledSkills(skillsDir);
selfEvolve.evaluateSkill(newSkill, skillsDir);

// Orchestrator
selfEvolve.runPostTask(projectDir, taskInfo);
selfEvolve.runSessionEnd(projectDir, skillsDir);
selfEvolve.getStatus(projectDir);
selfEvolve.initializeDataFiles(projectDir);
```

---

## Integration with Existing Commands

Self-evolve hooks into the existing solo-cto-agent workflow:

- **After `review`**: Quality check runs automatically (if enabled)
- **After `knowledge`**: Knowledge articles feed into the weekly report
- **`feedback` command**: Existing accept/reject feeds into personalization; self-evolve adds 1-5 scoring
- **`doctor` command**: Now also checks self-evolve health
- **`watch` mode**: Error patterns update on each iteration
- **Session end**: Improvement triggers check automatically
