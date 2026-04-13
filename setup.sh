#!/bin/bash
set -euo pipefail

REPO="https://github.com/seunghunbae-3svs/solo-cto-agent.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
TEMP_DIR="$(mktemp -d)"
MODE="${1:---full}"
TIER="${2:-base}"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "╔══════════════════════════════════════════════════╗"
echo "║  solo-cto-agent — Full Setup                    ║"
echo "║  Dual-Agent CI/CD Orchestrator                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

echo "[1/6] Downloading repository..."
git clone --depth 1 "$REPO" "$TEMP_DIR/solo-cto-agent" >/dev/null 2>&1
echo "  done"

SRC="$TEMP_DIR/solo-cto-agent"
mkdir -p "$SKILLS_DIR" "$CLAUDE_DIR" "$CLAUDE_DIR/templates"

# ─── Step 2: Install Skills ───

SKILLS=(build ship craft spark review memory orchestrate)

install_skill() {
  local skill="$1"
  local src="$SRC/skills/$skill"
  local dst="$SKILLS_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  $skill — not found in package, skipping"
    return
  fi

  case "$MODE" in
    --update|--force)
      rm -rf "$dst"
      cp -r "$src" "$dst"
      echo "  $skill — updated"
      ;;
    *)
      if [ -d "$dst" ]; then
        echo "  $skill — already exists, skipping"
      else
        cp -r "$src" "$dst"
        echo "  $skill — installed"
      fi
      ;;
  esac
}

echo "[2/6] Installing skills..."
for skill in "${SKILLS[@]}"; do
  install_skill "$skill"
done

# ─── Step 3: Copy Templates ───

echo "[3/6] Copying templates..."
cp "$SRC/templates/context.md" "$CLAUDE_DIR/templates/" 2>/dev/null || true
cp "$SRC/templates/project.md" "$CLAUDE_DIR/templates/" 2>/dev/null || true
echo "  templates — copied"

# ─── Step 4: CLAUDE.md Autopilot Block ───

AUTOPILOT_SRC="$SRC/autopilot.md"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
START_MARK="<!-- solo-cto-agent:start -->"
END_MARK="<!-- solo-cto-agent:end -->"

echo "[4/6] Updating CLAUDE.md..."
if [ -f "$AUTOPILOT_SRC" ]; then
  TMP_BLOCK="$TEMP_DIR/autopilot_block.md"
  {
    echo "$START_MARK"
    cat "$AUTOPILOT_SRC"
    echo ""
    echo "$END_MARK"
  } > "$TMP_BLOCK"

  if [ -f "$CLAUDE_MD" ]; then
    if grep -q "$START_MARK" "$CLAUDE_MD"; then
      python3 - <<PY
from pathlib import Path
claude_md = Path(r"$CLAUDE_MD")
new_block = Path(r"$TMP_BLOCK").read_text()
text = claude_md.read_text()
start = text.index("$START_MARK")
end = text.index("$END_MARK") + len("$END_MARK")
updated = text[:start] + new_block + text[end:]
claude_md.write_text(updated)
PY
      echo "  autopilot block updated"
    else
      printf "\n%s\n" "$(cat "$TMP_BLOCK")" >> "$CLAUDE_MD"
      echo "  autopilot block appended"
    fi
  else
    cp "$TMP_BLOCK" "$CLAUDE_MD"
    echo "  CLAUDE.md created"
  fi
else
  echo "  autopilot.md not found, skipping"
fi

# ─── Step 5: Setup Orchestrator Repo ───

echo "[5/6] Setting up orchestrator repo..."

ORCH_DIR="$(pwd)/dual-agent-review-orchestrator"
ORCH_TEMPLATE="$SRC/templates/orchestrator"

if [ -d "$ORCH_DIR/.git" ]; then
  echo "  Found existing orchestrator at $ORCH_DIR"
else
  mkdir -p "$ORCH_DIR"
  git -C "$ORCH_DIR" init >/dev/null 2>&1
  echo "  Created orchestrator repo at $ORCH_DIR"
fi

# Read tiers.json and copy files based on tier
TIERS_JSON="$SRC/tiers.json"

# Copy all base orchestrator workflows
echo "  Copying orchestrator workflows..."
mkdir -p "$ORCH_DIR/.github/workflows"

BASE_WORKFLOWS=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for w in d['tiers']['base']['orchestrator_workflows']:
    print(w)
")

for wf in $BASE_WORKFLOWS; do
  if [ -f "$ORCH_TEMPLATE/.github/workflows/$wf" ]; then
    cp "$ORCH_TEMPLATE/.github/workflows/$wf" "$ORCH_DIR/.github/workflows/"
  fi
done

# If pro tier, add pro workflows
if [ "$TIER" = "pro" ]; then
  PRO_WORKFLOWS=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for w in d['tiers']['pro']['additional_orchestrator_workflows']:
    print(w)
")
  for wf in $PRO_WORKFLOWS; do
    if [ -f "$ORCH_TEMPLATE/.github/workflows/$wf" ]; then
      cp "$ORCH_TEMPLATE/.github/workflows/$wf" "$ORCH_DIR/.github/workflows/"
    fi
  done
  echo "  Pro tier workflows added"
fi

# Copy full ops directory (simpler than parsing JSON for each file)
echo "  Copying ops directory..."
if [ -d "$ORCH_TEMPLATE/ops" ]; then
  cp -r "$ORCH_TEMPLATE/ops" "$ORCH_DIR/"
fi

# Copy other directories
for dir in api lib docs .claude .codex; do
  if [ -d "$ORCH_TEMPLATE/$dir" ]; then
    cp -r "$ORCH_TEMPLATE/$dir" "$ORCH_DIR/"
  fi
done

# Copy root config files
for f in package.json vercel.json tsconfig.json .env.example .gitignore CLAUDE.md; do
  if [ -f "$ORCH_TEMPLATE/$f" ]; then
    cp "$ORCH_TEMPLATE/$f" "$ORCH_DIR/"
  fi
done

WF_COUNT=$(ls -1 "$ORCH_DIR/.github/workflows/"*.yml 2>/dev/null | wc -l)
echo "  ✅ Orchestrator: $WF_COUNT workflows deployed"

# ─── Step 6: Summary ───

echo "[6/6] Setup complete!"
echo ""
echo "┌──────────────────────────────────────────────────┐"
echo "│  Installed:                                      │"
echo "│  • ${#SKILLS[@]} skills → $SKILLS_DIR            │"
echo "│  • Orchestrator → $ORCH_DIR                      │"
echo "│  • $WF_COUNT workflows                           │"
echo "│  • Tier: $TIER                                   │"
echo "└──────────────────────────────────────────────────┘"
echo ""
echo "Required GitHub Secrets:"
echo "  ANTHROPIC_API_KEY     — for Claude code/visual review"
echo "  GITHUB_TOKEN          — auto-provided by GitHub Actions"
if [ "$TIER" = "pro" ]; then
echo "  TELEGRAM_BOT_TOKEN    — for Telegram notifications (optional)"
echo "  TELEGRAM_CHAT_ID      — for Telegram channel (optional)"
fi
echo ""
echo "Next steps:"
echo "  1. cd dual-agent-review-orchestrator"
echo "  2. git add -A && git commit -m 'feat: init dual-agent orchestrator'"
echo "  3. gh repo create <name> --push --source . --private"
echo "  4. gh secret set ANTHROPIC_API_KEY"
echo ""
echo "To add workflows to a product repo:"
echo "  npx solo-cto-agent setup-repo ./my-product-repo"
echo ""
echo "Documentation: https://github.com/seunghunbae-3svs/solo-cto-agent"
