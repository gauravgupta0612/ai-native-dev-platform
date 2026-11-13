; NSIS installer for the AI-Native Developer Platform (per-user install, no admin rights needed).
; Built by build-windows.ps1. Sign the result with signtool before publishing.
Unicode true
!define APP "AI-Native Developer Platform"
Name "${APP} ${VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\AI-Native-Platform"
RequestExecutionLevel user

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\ai-platform.cmd"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AINativePlatform" "DisplayName" "${APP}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AINativePlatform" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AINativePlatform" "UninstallString" "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  RMDir /r "$SMPROGRAMS\${APP}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AINativePlatform"
SectionEnd
