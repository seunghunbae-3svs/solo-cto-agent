# solo-cto-agent

You're a solo founder. Your AI agent writes code, but you still spend hours on:
- debugging deploy failures it caused
- - re-explaining context every new session
  - - manually checking env vars, API keys, DB migrations before every task
    - - accepting AI-generated UI that screams "I was made by ChatGPT"
      - - getting "this is a great idea!" when you need someone to poke holes
       
        - This repo fixes that. Six skill files that turn a code-completing agent into one that thinks before it builds, remembers what you decided, and tells you when your idea has a hole in it.
       
        - ## Before / After
       
        - | Without solo-cto-agent | With solo-cto-agent |
        - |---|---|
        - | "Please add DATABASE_URL to your .env" | Agent scans prerequisites, asks once, configures everything |
        - | Same build error 5 times in a loop | Circuit breaker stops at 3, reports root cause |
        - | Agent forgets everything next session | Session memory persists decisions across conversations |
        - | "Should I create the file?" / "Should I use this skill?" | L1 autonomy: just does it, reports after |
        - | Generic blue gradients, rounded-everything UI | Anti-slop checklist enforces intentional design |
        - | "Great idea!" (no pushback) | 3-lens review: investor / user / competitor perspectives |
        - | You explain your stack every time | One-time `{{YOUR_*}}` placeholders, then it knows |
        - | Deploy > break > panic > manual fix | Deploy > monitor > auto-fix > rollback if needed |
       
        - ## What changes in practice
       
        - **Context switching** -- you stop re-explaining. The memory skill writes session episodes, compresses them into knowledge articles after 14 days, and loads relevant context at session start. You pick up where you left off.
       
        - **Deployment anxiety** -- the ship skill watches the build after push. If it fails, it reads the logs, attempts a fix, and only bothers you if the circuit breaker trips. Three attempts max, then a clear report instead of an error spiral.
       
        - **"AI slop" design** -- the craft skill runs a 10-point anti-slop checklist on every UI output. No gratuitous gradients, no blue-500-as-brand-color, no shadow-lg-on-everything. It enforces OKLCH color tokens, intentional font pairing, and motion that respects `prefers-reduced-motion`.
       
        - **Idea validation** -- spark takes a one-sentence idea through 6 stages (seed > market scan > competitors > unit economics > scenarios > PRD). Every number is tagged `[confirmed]` / `[estimated]` / `[unverified]`. No "the market is huge."
       
        - **Honest feedback** -- review evaluates from three perspectives: a VC seeing your deck for 30 seconds, a target user trying it for the first time, and your smartest competitor deciding whether to copy or ignore you. Output: score /10 with specific gaps.
       
        - ## Install
       
        - **One-liner:**
       
        - ```bash
          curl -sSL https://raw.githubusercontent.com/seunghunbae-3svs/solo-cto-agent/main/setup.sh | bash
          ```

          **Manual:**

          ```bash
          git clone https://github.com/seunghunbae-3svs/solo-cto-agent.git
          cp -r solo-cto-agent/skills/* ~/.claude/skills/
          cat solo-cto-agent/autopilot.md >> ~/.claude/CLAUDE.md
          ```

          **Cherry-pick** (only want the build pipeline?):

          ```bash
          cp -r solo-cto-agent/skills/build ~/.claude/skills/
          ```

          Then open `skills/build/SKILL.md` and replace the placeholders:

          ```
          {{YOUR_OS}}          >  macOS 15
          {{YOUR_EDITOR}}      >  Cursor
          {{YOUR_DEPLOY}}      >  Vercel
          {{YOUR_FRAMEWORK}}   >  Next.js 15
          ```

          ## How the autonomy works

          The agent operates on 3 levels, defined in `autopilot.md`:

          **L1 -- Just do it.** Fix typos, create files, load context, search the web, pick output formats. No confirmation needed. This eliminates the back-and-forth that makes agents feel like interns.

          **L2 -- Do, then report.** When the request is ambiguous, the agent picks the best assumption, delivers the result, and notes what it assumed. "Built this assuming Next.js 15 -- say otherwise and I'll adjust." No 5-question interrogation before starting.

          **L3 -- Ask first.** Production deploys, DB schema changes, anything sent under your name, cost-increasing decisions. These require explicit approval. Everything else doesn't.

          ## What's in the box

          ```
          solo-cto-agent/
          -- autopilot.md              < Autonomy rules. Merge into CLAUDE.md
          -- skills/
          |   -- build/SKILL.md        < Dev pipeline + pre-req scanner + circuit breaker
          |   -- ship/SKILL.md         < Deploy > monitor > auto-fix > rollback
          |   -- craft/SKILL.md        < Anti-slop design system (OKLCH, type, motion)
          |   -- spark/SKILL.md        < Idea > 6-stage validation > PRD
          |   -- review/SKILL.md       < 3-lens evaluator (investor / user / competitor)
          |   -- memory/SKILL.md       < Error patterns + session memory + self-improvement
          -- templates/
              -- project.md            < Per-project state tracker
              -- context.md            < Cross-session decision log
          ```

          ## Design principles

          **Agent does the work, you make decisions.** If the agent can figure it out, it should. Your time goes to judgment calls, not copy-pasting env vars.

          **Risks before strengths.** Every evaluation leads with what's broken, missing, or contradictory. Strengths come second. No cheerleading.

          **Facts over vibes.** Every number has a source or formula. Claims are tagged `[confirmed]`, `[estimated]`, or `[unverified]`. "Strong pipeline" and "growing rapidly" are banned phrases.

          **YAGNI.** Don't design Phase 3 features when Phase 0 isn't validated. If the user says "back to basics," the agent respects it. No expansion pressure.

          **Pre-scan, don't surprise.** Before writing a single line of code, scan for missing env vars, API keys, DB migrations, package dependencies. Ask once, configure everything. Never tell the user to "manually add this to your dashboard."

          ## License

          MIT -- fork it, modify it, ship it.
