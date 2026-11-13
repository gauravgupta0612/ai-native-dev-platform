#!/usr/bin/env bash
# One-time developer setup on Linux/macOS: ./scripts/setup.sh
set -euo pipefail
major=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
[ "${major:-0}" -ge 22 ] || { echo "Node.js 22 or newer is required: https://nodejs.org"; exit 1; }
npm install --no-audit --no-fund
[ -f .env ] || { cp config/.env.example .env; chmod 600 .env; echo "Created .env - add your API keys there (never commit it)."; }
npm run build
npm test
echo; echo "Ready. Start the CLI with:  npm start -- <path-to-your-project>"
