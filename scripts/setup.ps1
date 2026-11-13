# One-time developer setup on Windows (PowerShell, from the repository root): .\scripts\setup.ps1
$ErrorActionPreference = "Stop"
$node = (node --version) 2>$null
if (-not $node -or [int]($node.TrimStart('v').Split('.')[0]) -lt 22) { throw "Node.js 22 or newer is required: https://nodejs.org" }
npm install --no-audit --no-fund
if (-not (Test-Path ".env")) { Copy-Item "config\.env.example" ".env"; Write-Host "Created .env from config\.env.example - add your API keys there (never commit it)." }
npm run build
npm test
Write-Host "`nReady. Start the CLI with:  npm start -- <path-to-your-project>"
