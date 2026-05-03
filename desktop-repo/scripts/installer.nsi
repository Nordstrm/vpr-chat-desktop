; ============================================================================
; VPR Chat — branded NSIS installer
; ----------------------------------------------------------------------------
; Builds VPR-Chat-Setup.exe with:
;   - VPR-branded welcome / finish pages (cyan knot sidebar bitmap)
;   - VPR-branded header strip on every wizard step
;   - Custom wording everywhere ("Install VPR Chat", not generic NSIS text)
;   - Optional desktop shortcut page
;   - Start Menu shortcut + Add/Remove Programs entry + Uninstaller
;   - Auto-launches VPR Chat on finish
;
; This file is consumed by the in-app updater (silent /S flag) AND by users
; who download the .exe directly from https://vprchat.lovable.app/download.
; The /S codepath skips the wizard entirely; the manual codepath shows the
; full branded experience.
; ============================================================================

!define APPNAME "VPR Chat"
!define COMPANYNAME "VPRCHAT"
!define DESCRIPTION "Encrypted Ephemeral Messaging"
!define VERSIONMAJOR 1
!define VERSIONMINOR 0
!define VERSIONBUILD 2
!define HELPURL "https://vprchat.lovable.app"
!define INSTALLSIZE 250000

; ----- File metadata (Properties → Details on the .exe) ---------------------
VIProductVersion "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}.0"
VIAddVersionKey "ProductName"      "${APPNAME}"
VIAddVersionKey "CompanyName"      "${COMPANYNAME}"
VIAddVersionKey "LegalCopyright"   "© VPRCHAT"
VIAddVersionKey "FileDescription"  "${APPNAME} Setup"
VIAddVersionKey "FileVersion"      "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}.0"
VIAddVersionKey "ProductVersion"   "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}.0"
VIAddVersionKey "OriginalFilename" "VPR-Chat-Setup.exe"

Name              "${APPNAME}"
OutFile           "..\electron-release\VPR-Chat-Setup.exe"
InstallDir        "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey  HKLM "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel admin
Unicode True
BrandingText      "VPR Chat ${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD} — Privacy by default"

; ----- MUI2 (Modern UI) branding -------------------------------------------
!include "MUI2.nsh"
!include "nsDialogs.nsh"

; Window chrome
!define MUI_ICON                  "..\build\icon.ico"
!define MUI_UNICON                "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT     "Abort the VPR Chat installation? You can install again any time from vprchat.lovable.app/download."

; Welcome / Finish — full sidebar bitmap (164x314 BMP3)
!define MUI_WELCOMEFINISHPAGE_BITMAP        "..\build\installer-sidebar.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP      "..\build\installer-sidebar.bmp"

; Header on every other wizard page (150x57 BMP3)
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP              "..\build\installer-header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP            "..\build\installer-header.bmp"
!define MUI_HEADERIMAGE_RIGHT

; Welcome page copy
!define MUI_WELCOMEPAGE_TITLE               "Welcome to VPR Chat"
!define MUI_WELCOMEPAGE_TEXT                "VPR Chat is privacy-first messaging with post-quantum end-to-end encryption, zero-knowledge accounts, and 24-hour ephemeral messages.$\r$\n$\r$\nThis wizard will install VPR Chat ${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD} on your computer.$\r$\n$\r$\nClick Next to continue."

; Directory page copy
!define MUI_DIRECTORYPAGE_TEXT_TOP          "VPR Chat will be installed in the folder below. To install in a different folder, click Browse."

; Finish page — auto-run + custom copy + a "Visit website" checkbox
!define MUI_FINISHPAGE_TITLE                "VPR Chat is ready"
!define MUI_FINISHPAGE_TEXT                 "VPR Chat ${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD} has been installed.$\r$\n$\r$\nThanks for choosing privacy-first messaging."
!define MUI_FINISHPAGE_RUN                  "$INSTDIR\VPR Chat.exe"
!define MUI_FINISHPAGE_RUN_TEXT             "Launch VPR Chat now"
!define MUI_FINISHPAGE_LINK                 "vprchat.lovable.app"
!define MUI_FINISHPAGE_LINK_LOCATION        "https://vprchat.lovable.app"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; Uninstaller wording
!define MUI_UNCONFIRMPAGE_TEXT_TOP          "VPR Chat will be removed from your computer. Your encrypted credentials and account remain safe — they live in the cloud, not on this device."
!define MUI_UNFINISHPAGE_NOAUTOCLOSE

; ----- Pages ----------------------------------------------------------------
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom DesktopShortcutPage DesktopShortcutPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ----- Custom "Create desktop shortcut?" page ------------------------------
Var DesktopCheckbox
Var CreateDesktopShortcut
Var ShortcutPageHeading
Var ShortcutPageBlurb

Function DesktopShortcutPage
  !insertmacro MUI_HEADER_TEXT "Shortcut options" "Choose where you want to launch VPR Chat from."
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 14u "Shortcuts"
  Pop $ShortcutPageHeading
  CreateFont $1 "$(^Font)" "10" "700"
  SendMessage $ShortcutPageHeading ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 0 18u 100% 24u "VPR Chat will always be in your Start Menu. You can also pin a shortcut to your desktop for one-click access."
  Pop $ShortcutPageBlurb

  ${NSD_CreateCheckbox} 0 48u 100% 12u "Create a desktop shortcut"
  Pop $DesktopCheckbox
  ${NSD_Check} $DesktopCheckbox

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopCheckbox $CreateDesktopShortcut
FunctionEnd

; ----- Install --------------------------------------------------------------
Section "Install"
  ; If a previous install exists, wipe it first so renamed/removed files
  ; from the old version don't linger alongside the new ones.
  ; Skips the user's data folder (that lives under %APPDATA%\VPR Chat, not here).
  IfFileExists "$INSTDIR\VPR Chat.exe" 0 +3
    DetailPrint "Removing previous version..."
    RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  ; Pack the entire packaged Electron app
  File /r "..\electron-release\VPR Chat-win32-x64\*.*"

  ; Start Menu
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\VPR Chat.exe" "" "$INSTDIR\VPR Chat.exe" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Optional desktop shortcut
  ${If} $CreateDesktopShortcut == 1
    CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\VPR Chat.exe" "" "$INSTDIR\VPR Chat.exe" 0
  ${EndIf}

  ; Add/Remove Programs entry
  WriteRegStr   HKLM "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName"      "${APPNAME}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString"  "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon"      "$INSTDIR\VPR Chat.exe"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher"        "${COMPANYNAME}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion"   "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONBUILD}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "HelpLink"         "${HELPURL}"
  WriteRegStr   HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "URLInfoAbout"     "${HELPURL}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify"         1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair"         1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "EstimatedSize"    ${INSTALLSIZE}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
  RMDir  "$SMPROGRAMS\${APPNAME}"

  RMDir /r "$INSTDIR"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKLM "Software\${APPNAME}"
SectionEnd
