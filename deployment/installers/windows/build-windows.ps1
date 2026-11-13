# Builds a portable Windows package and (if NSIS is installed) an EXE installer.
# Usage (PowerShell, from the repository root):  .\deployment\installers\windows\build-windows.ps1 -Version 0.1.0
param([string]$Version = "0.1.0")
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\..\.."
Set-Location $root

npm ci --no-audit --no-fund
npm run build
npm test

$out = "release\windows"
New-Item -ItemType Directory -Force -Path "$out\app" | Out-Null
Copy-Item -Recurse -Force dist, config, package.json "$out\app\"
Set-Content "$out\app\ai-platform.cmd" "@echo off`r`nnode `"%~dp0dist\apps\desktop-ide\cli.js`" %*"
Compress-Archive -Force -Path "$out\app\*" -DestinationPath "$out\ai-native-platform-$Version-win-x64.zip"

if (Get-Command makensis -ErrorAction SilentlyContinue) {
  makensis /DVERSION=$Version /DSRC="$out\app" /DOUT="$out\ai-native-platform-$Version-setup.exe" "$PSScriptRoot\installer.nsi"
} else {
  Write-Host "NSIS not found: skipped EXE installer (zip created)."
}
Get-FileHash "$out\*.zip","$out\*.exe" -Algorithm SHA256 -ErrorAction SilentlyContinue | Format-Table -AutoSize
