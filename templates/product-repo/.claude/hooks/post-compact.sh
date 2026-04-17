#!/bin/bash
# Post-compaction context renewal hook
# Fires after Claude Code /compact — re-injects critical project context
# This ensures type definitions, schema, and project rules survive context compaction
#
# Usage: Automatically triggered by Claude Code settings.json
#        Or manually: bash .claude/hooks/post-compact.sh

set -euo pipefail

# Color codes for readability
BOLD='\033[1m'
BLUE='\033[34m'
GREEN='\033[32m'
RESET='\033[0m'

# Output goes to Claude as system message
echo ""
echo "=== POST-COMPACTION CONTEXT RENEWAL ==="
echo ""

# Re-read CLAUDE.md (project rules) — CRITICAL
if [ -f "CLAUDE.md" ]; then
  echo -e "${BOLD}## Project Rules (from CLAUDE.md)${RESET}"
  cat CLAUDE.md
  echo ""
fi

# Re-read current branch and recent changes
echo -e "${BOLD}## Current Git State${RESET}"
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo "Recent commits:"
git log --oneline -5 2>/dev/null || echo "N/A"
echo ""

# Re-read key type definitions
echo -e "${BOLD}## Key Type Definitions${RESET}"
# TypeScript projects — look for type definitions
for f in src/types/index.ts src/types/*.ts types/*.ts; do
  if [ -f "$f" ]; then
    echo -e "${BLUE}### $f${RESET}"
    cat "$f"
    echo ""
  fi
done

# Re-read component interfaces (common source of compaction errors)
echo -e "${BOLD}## Component Props Interfaces${RESET}"
if grep -rn "interface.*Props\|type.*Props" src/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -30; then
  echo ""
else
  echo "No component props interfaces found"
  echo ""
fi

# Re-read schema (Prisma, Supabase, or custom)
for f in prisma/schema.prisma src/lib/db/schema.ts supabase/schema.sql db/schema.sql; do
  if [ -f "$f" ]; then
    echo -e "${BOLD}## Database Schema ($f)${RESET}"
    cat "$f"
    echo ""
  fi
done

# Re-read package.json dependencies (for context about stack)
if [ -f "package.json" ]; then
  echo -e "${BOLD}## Project Stack & Key Dependencies${RESET}"
  # Extract project name and first 20 deps
  python3 << 'PYTHON_EOF' 2>/dev/null || cat package.json | head -50
import json
import sys
try:
    with open('package.json', 'r') as f:
        d = json.load(f)
    print(f"Project: {d.get('name', 'unknown')}")
    print(f"Version: {d.get('version', 'unknown')}")
    print("")
    print("Dependencies:")
    deps = d.get('dependencies', {})
    for k in list(deps.keys())[:20]:
        print(f"  {k}: {deps[k]}")
    if len(deps) > 20:
        print(f"  ... and {len(deps) - 20} more")
except Exception as e:
    print(f"Error reading package.json: {e}")
PYTHON_EOF
  echo ""
fi

# Re-read build/dev configuration
echo -e "${BOLD}## Build & Development Configuration${RESET}"
for f in tsconfig.json next.config.js vite.config.ts tailwind.config.js webpack.config.js; do
  if [ -f "$f" ]; then
    echo -e "${BLUE}### $f${RESET}"
    head -50 "$f" 2>/dev/null || true
    echo ""
  fi
done

# Re-read any compaction-aware CLAUDE.md section
if grep -q "## Compaction Survival Rules\|## Post-Compaction" CLAUDE.md 2>/dev/null; then
  echo -e "${BOLD}## Compaction Defense Checklist${RESET}"
  echo "This project has explicit compaction survival rules. CHECK:"
  echo "  [ ] Re-read CLAUDE.md above"
  echo "  [ ] Check current branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
  echo "  [ ] Review type definitions in src/types/"
  echo "  [ ] Verify component Props interfaces exist"
  echo "  [ ] Validate database schema is current"
  echo "  [ ] Before editing any component, re-read its interface definitions"
  echo "  [ ] Run build/type-check after EVERY file change"
  echo ""
fi

echo -e "${GREEN}=== END POST-COMPACTION CONTEXT ===${RESET}"
echo ""
echo "✓ Context renewal complete. You can now continue editing with full project context."
echo ""
