#!/bin/bash
set -e

REPO="https://github.com/seunghunbae-3svs/solo-cto-agent.git"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
SKILLS_DIR="$CLAUDE_DIR/skills"
TEMP_DIR=$(mktemp -d)

echo "=== solo-cto-agent installer ==="
echo ""

# Clone
echo "[1/4] Downloading solo-cto-agent..."
git clone --depth 1 "$REPO" "$TEMP_DIR/solo-cto-agent" 2>/dev/null
echo "      Done."

# Create dirs if needed
echo "[2/4] Setting up skill directories..."
mkdir -p "$SKILLS_DIR"
mkdir -p "$CLAUDE_DIR"

# Copy skills
echo "[3/4] Installing skills..."
SKILLS=(build ship craft spark review memory)
for skill in "${SKILLS[@]}"; do
  if [ -d "$SKILLS_DIR/$skill" ]; then
    echo "      $skill — already exists, skipping (delete it first to reinstall)"
  else
    cp -r "$TEMP_DIR/solo-cto-agent/skills/$skill" "$SKILLS_DIR/$skill"
    echo "      $skill — installed"
  fi
done

# Copy templates
mkdir -p "$CLAUDE_DIR/templates"
cp "$TEMP_DIR/solo-cto-agent/templates/"*.md "$CLAUDE_DIR/templates/" 2>/dev/null || true
echo "      templates — copied"

# Append autopilot rules
echo "[4/4] Appending autopilot rules to CLAUDE.md..."
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  echo "" >> "$CLAUDE_DIR/CLAUDE.md"
  echo "<!-- solo-cto-agent autopilot rules -->" >> "$CLAUDE_DIR/CLAUDE.md"
  cat "$TEMP_DIR/solo-cto-agent/autopilot.md" >> "$CLAUDE_DIR/CLAUDE.md"
  echo "      Appended to existing CLAUDE.md"
else
  cp "$TEMP_DIR/solo-cto-agent/autopilot.md" "$CLAUDE_DIR/CLAUDE.md"
  echo "      Created new CLAUDE.md with autopilot rules"
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Installation complete ==="
echo ""
echo "Installed skills: ${SKILLS[*]}"
echo "Skills directory:  $SKILLS_DIR"
echo "Autopilot rules:   $CLAUDE_DIR/CLAUDE.md"
echo "Templates:         $CLAUDE_DIR/templates/"
echo ""
echo "Next steps:"
echo "  1. Open skills/build/SKILL.md and replace {{YOUR_*}} placeholders with your stack"
echo "  2. Review autopilot.md rules in CLAUDE.md — adjust autonomy levels if needed"
echo "  3. Start a new Claude session and watch it work"
echo ""
