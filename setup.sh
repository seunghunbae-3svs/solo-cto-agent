#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════
# solo-cto-agent — One-Command Setup
# Usage:
#   curl -sSL https://raw.githubusercontent.com/seunghunbae-3svs/solo-cto-agent/main/setup.sh | bash
#   bash setup.sh --org myorg --tier cto --repos app1,app2
# ═══════════════════════════════════════════════════════

REPO="https://github.com/seunghunbae-3svs/solo-cto-agent.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
TEMP_DIR="$(mktemp -d)"

# ─── Parse Arguments ───
ORG=""
TIER="builder"
REPOS=""
ORCH_NAME="dual-agent-orchestrator"
MODE="--install"

while [[ $# -gt 0 ]]; do
  case $1 in
    --org) ORG="$2"; shift 2 ;;
    --tier) TIER="$2"; shift 2 ;;
    --repos) REPOS="$2"; shift 2 ;;
    --orchestrator-name) ORCH_NAME="$2"; shift 2 ;;
    --update|--force) MODE="$1"; shift ;;
    --help|-h)
      echo "Usage: bash setup.sh --org <github-org> [--tier builder|cto] [--repos repo1,repo2]"
      echo ""
      echo "Options:"
      echo "  --org <org>                GitHub org or username (REQUIRED)"
      echo "  --tier builder|cto         builder=Lv4 base (default), cto=Lv5+6 pro"
      echo "  --repos <repo1,repo2>      Product repos to install workflows into"
      echo "  --orchestrator-name <name> Custom orchestrator repo name (default: dual-agent-orchestrator)"
      echo "  --update                   Overwrite existing skills"
      exit 0
      ;;
    *) shift ;;
  esac
done

if [ -z "$ORG" ]; then
  echo "❌ --org is required."
  echo ""
  echo "Usage: bash setup.sh --org <github-org> [--tier builder|cto]"
  echo "Example: bash setup.sh --org mycompany --tier cto --repos myapp1,myapp2"
  exit 1
fi

cleanup() { rm -rf "$TEMP_DIR"; }
trap cleanup EXIT

echo "╔══════════════════════════════════════════════════╗"
echo "║  solo-cto-agent — Full Setup                    ║"
echo "║  Org:  $ORG"
echo "║  Tier: $TIER"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Download ───

echo "[1/7] Downloading repository..."
git clone --depth 1 "$REPO" "$TEMP_DIR/solo-cto-agent" >/dev/null 2>&1
echo "  done"

SRC="$TEMP_DIR/solo-cto-agent"
mkdir -p "$SKILLS_DIR" "$CLAUDE_DIR" "$CLAUDE_DIR/templates"

# ─── Step 2: Install Skills ───

# Builder (Lv4): build + ship + craft + spark + review + memory
# CTO (Lv5+6): Builder + orchestrate
if [ "$TIER" = "cto" ]; then
  SKILLS=(build ship craft spark review memory orchestrate)
else
  SKILLS=(build ship craft spark review memory)
fi

install_skill() {
  local skill="$1"
  local src="$SRC/skills/$skill"
  local dst="$SKILLS_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  $skill — not found, skipping"
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
        echo "  $skill — exists, skipping"
      else
        cp -r "$src" "$dst"
        echo "  $skill — installed"
      fi
      ;;
  esac
}

echo "[2/7] Installing skills..."
for skill in "${SKILLS[@]}"; do
  install_skill "$skill"
done

# ─── Step 3: Templates ───

echo "[3/7] Copying templates..."
cp "$SRC/templates/context.md" "$CLAUDE_DIR/templates/" 2>/dev/null || true
cp "$SRC/templates/project.md" "$CLAUDE_DIR/templates/" 2>/dev/null || true
echo "  done"

# ─── Step 4: CLAUDE.md Autopilot Block ───

AUTOPILOT_SRC="$SRC/autopilot.md"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
START_MARK="<!-- solo-cto-agent:start -->"
END_MARK="<!-- solo-cto-agent:end -->"

echo "[4/7] Updating CLAUDE.md..."
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

echo "[5/7] Setting up orchestrator repo..."

ORCH_DIR="$(pwd)/$ORCH_NAME"
ORCH_TEMPLATE="$SRC/templates/orchestrator"

if [ -d "$ORCH_DIR/.git" ]; then
  echo "  Found existing: $ORCH_DIR"
else
  mkdir -p "$ORCH_DIR"
  git -C "$ORCH_DIR" init >/dev/null 2>&1
  echo "  Created: $ORCH_DIR"
fi

# Template variable replacement function
replace_placeholders() {
  local file="$1"
  if [ -f "$file" ]; then
    sed -i "s|{{GITHUB_OWNER}}|$ORG|g" "$file"
    sed -i "s|{{ORCHESTRATOR_REPO}}|$ORCH_NAME|g" "$file"
    # Replace product repo placeholders with generic names if not specified
    for i in $(seq 1 10); do
      sed -i "s|{{PRODUCT_REPO_$i}}|your-product-repo-$i|g" "$file"
    done
  fi
}

# Replace product repo placeholders with actual names if provided
IFS=',' read -ra REPO_ARRAY <<< "${REPOS:-}"
set_product_repo_names() {
  local file="$1"
  local idx=1
  for repo in "${REPO_ARRAY[@]}"; do
    repo=$(echo "$repo" | xargs) # trim
    if [ -n "$repo" ]; then
      sed -i "s|{{PRODUCT_REPO_$idx}}|$(basename "$repo")|g" "$file"
      idx=$((idx + 1))
    fi
  done
}

# Copy orchestrator workflows based on tier
TIERS_JSON="$SRC/tiers.json"
echo "  Copying workflows..."
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

# CTO tier = pro (Lv5+6)
if [ "$TIER" = "cto" ]; then
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
fi

# Copy ops, api, lib, docs, .claude, .codex
echo "  Copying operational code..."
for dir in ops api lib docs .claude .codex; do
  if [ -d "$ORCH_TEMPLATE/$dir" ]; then
    cp -r "$ORCH_TEMPLATE/$dir" "$ORCH_DIR/"
  fi
done

# Copy root config
for f in package.json vercel.json tsconfig.json .env.example .gitignore CLAUDE.md; do
  if [ -f "$ORCH_TEMPLATE/$f" ]; then
    cp "$ORCH_TEMPLATE/$f" "$ORCH_DIR/"
  fi
done

# Replace all placeholders in copied files
echo "  Replacing placeholders with your org/repo names..."
find "$ORCH_DIR" -type f \( -name "*.yml" -o -name "*.js" -o -name "*.ts" -o -name "*.md" -o -name "*.json" -o -name "*.sh" \) | while read -r file; do
  if [ ${#REPO_ARRAY[@]} -gt 0 ] && [ -n "${REPO_ARRAY[0]}" ]; then
    set_product_repo_names "$file"
  fi
  replace_placeholders "$file"
done

# Builder tier: override routing-policy + agent-scores for single-agent mode
if [ "$TIER" != "cto" ]; then
  echo "  Applying single-agent config..."
  BUILDER_DEFAULTS="$SRC/templates/builder-defaults"
  cp "$BUILDER_DEFAULTS/routing-policy.json" "$ORCH_DIR/ops/orchestrator/routing-policy.json"
  # Replace timestamp placeholder in agent-scores
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  sed "s|{{SETUP_TIMESTAMP}}|$TIMESTAMP|g" "$BUILDER_DEFAULTS/agent-scores.json" > "$ORCH_DIR/ops/orchestrator/agent-scores.json"
  echo "  ✅ Single-agent config applied"
fi

WF_COUNT=$(ls -1 "$ORCH_DIR/.github/workflows/"*.yml 2>/dev/null | wc -l)
echo "  ✅ Orchestrator: $WF_COUNT workflows deployed"

# ─── Step 6: Install Product Repo Workflows ───

echo "[6/7] Installing product repo workflows..."

# Build workflow list based on tier
# Builder (Lv4) = single-agent (Claude only)
# CTO (Lv5+6) = multi-agent (Claude + Codex + cross-review)
BUILDER_PRODUCT_WFS=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for w in d['product_repo_templates']['builder']['workflows']:
    print(w)
")

CTO_ADDITIONAL_WFS=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for w in d['product_repo_templates']['cto']['additional_workflows']:
    print(w)
")

OPTIONAL_WFS=$(python3 -c "
import json
d = json.load(open('$TIERS_JSON'))
for w in d['product_repo_templates']['optional']['workflows']:
    print(w)
")

if [ -z "$REPOS" ]; then
  echo "  No --repos specified. Run later:"
  echo "  npx solo-cto-agent setup-repo ./my-app --org $ORG"
else
  IFS=',' read -ra PRODUCT_REPOS <<< "$REPOS"
  for repo in "${PRODUCT_REPOS[@]}"; do
    repo=$(echo "$repo" | xargs)
    repo_dir="$(pwd)/$repo"
    if [ ! -d "$repo_dir" ]; then
      repo_dir="$repo"
    fi
    if [ ! -d "$repo_dir" ]; then
      echo "  ⚠️  $repo — not found, skipping"
      continue
    fi

    mkdir -p "$repo_dir/.github/workflows"
    WF_INSTALLED=0

    # Install builder (single-agent) workflows
    for wf in $BUILDER_PRODUCT_WFS; do
      if [ -f "$SRC/templates/product-repo/.github/workflows/$wf" ]; then
        cp "$SRC/templates/product-repo/.github/workflows/$wf" "$repo_dir/.github/workflows/"
        WF_INSTALLED=$((WF_INSTALLED + 1))
      fi
    done

    # CTO tier: add multi-agent workflows
    if [ "$TIER" = "cto" ]; then
      for wf in $CTO_ADDITIONAL_WFS; do
        if [ -f "$SRC/templates/product-repo/.github/workflows/$wf" ]; then
          cp "$SRC/templates/product-repo/.github/workflows/$wf" "$repo_dir/.github/workflows/"
          WF_INSTALLED=$((WF_INSTALLED + 1))
        fi
      done
    fi

    # Optional workflows (both tiers)
    for wf in $OPTIONAL_WFS; do
      if [ -f "$SRC/templates/product-repo/.github/workflows/$wf" ]; then
        cp "$SRC/templates/product-repo/.github/workflows/$wf" "$repo_dir/.github/workflows/"
        WF_INSTALLED=$((WF_INSTALLED + 1))
      fi
    done

    # Replace placeholders in product repo workflows
    find "$repo_dir/.github/workflows" -name "*.yml" | while read -r file; do
      replace_placeholders "$file"
    done

    AGENT_LABEL=$([ "$TIER" = "cto" ] && echo "multi-agent" || echo "single-agent")
    echo "  ✅ $repo — $WF_INSTALLED workflows ($AGENT_LABEL)"
  done
fi

# ─── Step 7: Summary + Required Secrets ───

echo ""
echo "[7/7] Setup complete!"
echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  Summary                                                 │"
echo "├──────────────────────────────────────────────────────────┤"
echo "│  Org:          $ORG"
echo "│  Tier:         $TIER ($([ "$TIER" = "cto" ] && echo "Lv5+6 Pro" || echo "Lv4 Base"))"
echo "│  Skills:       ${#SKILLS[@]} installed"
echo "│  Orchestrator: $ORCH_DIR"
echo "│  Workflows:    $WF_COUNT"
echo "└──────────────────────────────────────────────────────────┘"
echo ""
echo "═══ REQUIRED: Set GitHub Secrets ═══"
echo ""
echo "Run these commands in your orchestrator repo:"
echo ""
echo "  cd $ORCH_NAME"
echo "  git add -A && git commit -m 'feat: init dual-agent orchestrator'"
echo "  gh repo create $ORG/$ORCH_NAME --push --source . --private"
echo ""
echo "Then set secrets (REQUIRED for automation to work):"
echo ""
echo "  # 1. GitHub PAT with repo + workflow scope (for cross-repo dispatch)"
echo "  gh secret set ORCHESTRATOR_PAT"
echo ""
echo "  # 2. Anthropic API key (for Claude code review + visual analysis)"
echo "  gh secret set ANTHROPIC_API_KEY"
echo ""
if [ "$TIER" = "cto" ]; then
echo "  # 3. OpenAI API key (for Codex agent + AI-powered analysis — CTO tier)"
echo "  gh secret set OPENAI_API_KEY"
echo ""
fi
echo "  # Telegram notifications (optional, both tiers)"
echo "  gh secret set TELEGRAM_BOT_TOKEN"
echo "  gh secret set TELEGRAM_CHAT_ID"
echo ""
echo "Also set secrets on EACH product repo:"
echo ""
echo "  cd ../your-product-repo"
if [ "$TIER" = "cto" ]; then
echo "  gh secret set ORCHESTRATOR_PAT && gh secret set ANTHROPIC_API_KEY && gh secret set OPENAI_API_KEY"
else
echo "  gh secret set ORCHESTRATOR_PAT && gh secret set ANTHROPIC_API_KEY"
fi
echo ""
echo "═══ Why each secret is needed ═══"
echo ""
echo "  ORCHESTRATOR_PAT  Cross-repo dispatch (product → orchestrator)"
echo "                    Required scope: repo, workflow"
echo "                    Create at: https://github.com/settings/tokens"
echo ""
echo "  ANTHROPIC_API_KEY Claude-powered code review, visual analysis,"
echo "                    UI/UX quality gate, auto-fix suggestions"
echo "                    Get at: https://console.anthropic.com"
echo ""
if [ "$TIER" = "cto" ]; then
echo "  OPENAI_API_KEY    Codex agent, AI-powered code analysis (CTO tier)"
echo "                    Get at: https://platform.openai.com/api-keys"
echo ""
fi
echo "  TELEGRAM_*        Real-time PR/review notifications (optional, both tiers)"
echo "                    Get at: https://t.me/BotFather"
echo ""
echo "  GITHUB_TOKEN      Auto-provided by GitHub Actions (no action needed)"
echo ""
echo "Documentation: https://github.com/seunghunbae-3svs/solo-cto-agent"
