#!/bin/bash
set -euo pipefail

REPO="https://github.com/seunghunbae-3svs/solo-cto-agent.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
TEMP_DIR="$(mktemp -d)"
MODE="${1:---install}"

cleanup() {
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo "=== solo-cto-agent installer ==="
echo ""

echo "[1/4] Downloading repository..."
git clone --depth 1 "$REPO" "$TEMP_DIR/solo-cto-agent" >/dev/null 2>&1
echo "  done"

mkdir -p "$SKILLS_DIR" "$CLAUDE_DIR" "$CLAUDE_DIR/templates"

SKILLS=(build ship craft spark review memory)

install_skill() {
  local skill="$1"
  local src="$TEMP_DIR/solo-cto-agent/skills/$skill"
  local dst="$SKILLS_DIR/$skill"

  if [ ! -d "$src" ]; then
    echo "  missing skill: $skill"
    exit 1
  fi

  case "$MODE" in
    --update|--force)
      rm -rf "$dst"
      cp -r "$src" "$dst"
      echo "  $skill — updated"
      ;;
    --install)
      if [ -d "$dst" ]; then
        echo "  $skill — already exists, skipping"
      else
        cp -r "$src" "$dst"
        echo "  $skill — installed"
      fi
      ;;
    *)
      echo "Unknown mode: $MODE"
      echo "Use one of: --install, --update, --force"
      exit 1
      ;;
  esac
}

echo "[2/4] Installing skills..."
for skill in "${SKILLS[@]}"; do
  install_skill "$skill"
done

echo "[3/4] Copying templates..."
cp "$TEMP_DIR/solo-cto-agent/templates/"*.md "$CLAUDE_DIR/templates/" 2>/dev/null || true
echo "  templates — copied"

AUTOPILOT_SRC="$TEMP_DIR/solo-cto-agent/autopilot.md"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
START_MARK="<!-- solo-cto-agent:start -->"
END_MARK="<!-- solo-cto-agent:end -->"

echo "[4/4] Updating CLAUDE.md..."
if [ ! -f "$AUTOPILOT_SRC" ]; then
  echo "Missing autopilot.md in repository clone"
  exit 1
fi

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
    echo "  existing autopilot block updated"
  else
    printf "\n%s\n" "$(cat "$TMP_BLOCK")" >> "$CLAUDE_MD"
    echo "  autopilot block appended"
  fi
else
  cp "$TMP_BLOCK" "$CLAUDE_MD"
  echo "  CLAUDE.md created"
fi

echo ""
echo "=== Installation complete ==="
echo ""
echo "Installed skills: ${SKILLS[*]}"
echo "Skills directory:  $SKILLS_DIR"
echo "CLAUDE.md:         $CLAUDE_MD"
echo "Templates:         $CLAUDE_DIR/templates/"
echo ""
echo "Next steps:"
echo "  1. Replace {{YOUR_*}} placeholders in the skills you plan to use"
echo "  2. Start with build + review if you want the easiest trial"
echo "  3. Re-run with --update later if you want refreshed skill files"
