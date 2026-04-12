```bash
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

git clone --depth 1 "$REPO" "$TEMP_DIR/solo-cto-agent" >/dev/null 2>&1

mkdir -p "$SKILLS_DIR" "$CLAUDE_DIR" "$CLAUDE_DIR/templates"

SKILLS=(build ship craft spark review memory)

install_skill() {
  local skill="$1"
  local src="$TEMP_DIR/solo-cto-agent/skills/$skill"
  local dst="$SKILLS_DIR/$skill"

  if [ "$MODE" = "--force" ] || [ "$MODE" = "--update" ]; then
    rm -rf "$dst"
    cp -r "$src" "$dst"
    echo "  $skill — updated"
    return
  fi

  if [ -d "$dst" ]; then
    echo "  $skill — already exists, skipping"
  else
    cp -r "$src" "$dst"
    echo "  $skill — installed"
  fi
}

echo "[1/4] Installing skills..."
for skill in "${SKILLS[@]}"; do
  install_skill "$skill"
done

echo "[2/4] Copying templates..."
cp "$TEMP_DIR/solo-cto-agent/templates/"*.md "$CLAUDE_DIR/templates/" 2>/dev/null || true
echo "  templates — copied"

AUTOPILOT_SRC="$TEMP_DIR/solo-cto-agent/autopilot.md"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
START_MARK="<!-- solo-cto-agent:start -->"
END_MARK="<!-- solo-cto-agent:end -->"

echo "[3/4] Updating CLAUDE.md..."
if [ ! -f "$AUTOPILOT_SRC" ]; then
  echo "Missing autopilot.md in repository clone"
  exit 1
fi

AUTOPILOT_BLOCK="$(printf "%s\n" "$START_MARK"; cat "$AUTOPILOT_SRC"; printf "\n%s\n" "$END_MARK")"

if [ -f "$CLAUDE_MD" ]; then
  if grep -q "$START_MARK" "$CLAUDE_MD"; then
    python3 - <<PY
from pathlib import Path
path = Path("$CLAUDE_MD")
text = path.read_text()
start = text.index("$START_MARK")
end = text.index("$END_MARK") + len("$END_MARK")
new_block = """$AUTOPILOT_BLOCK"""
path.write_text(text[:start] + new_block + text[end:])
PY
    echo "  existing autopilot block updated"
  else
    printf "\n%s\n" "$AUTOPILOT_BLOCK" >> "$CLAUDE_MD"
    echo "  autopilot block appended"
  fi
else
  printf "%s\n" "$AUTOPILOT_BLOCK" > "$CLAUDE_MD"
  echo "  CLAUDE.md created"
fi

echo "[4/4] Done"
echo ""
echo "Installed skills: ${SKILLS[*]}"
echo "Skills directory: $SKILLS_DIR"
echo "CLAUDE.md: $CLAUDE_MD"
echo "Templates: $CLAUDE_DIR/templates/"
echo ""
echo "Next steps:"
echo "  1. Replace {{YOUR_*}} placeholders in the skills you plan to use"
echo "  2. Start with build + review if you want the easiest trial"
```
