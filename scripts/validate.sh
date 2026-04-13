#!/usr/bin/env bash
set -euo pipefail

pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/validate-cli-bin.ps1
node scripts/validate-package.js
