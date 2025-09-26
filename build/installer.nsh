; PhasePad Installer Configuration
; Handles updates, startup registry, and existing installation detection

; Check for existing installation and handle updates
!macro customHeader
  ; This ensures the installer can find and update existing installations
!macroend

; Custom installation steps
!macro customInstall
  ; Check if app is running and close it
  nsExec::Exec 'taskkill /F /IM PhasePad.exe'
  
  ; Add startup entry after installation
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PhasePad" "$INSTDIR\PhasePad.exe --startup"
  
  ; Write installation info to registry for future updates
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}" "DisplayName" "PhasePad"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}" "Publisher" "OwenModsTW"
!macroend

; Custom uninstall steps
!macro customUnInstall
  ; Remove startup entry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PhasePad"
  
  ; Clean up registry entries
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}"
!macroend

; Handle init - detect existing installation
!macro customInit
  ; Check for existing installation
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\{a1b2c3d4-e5f6-7890-abcd-ef1234567890}" "InstallLocation"
  ${If} $R0 != ""
    ; Existing installation found, set install directory to existing location
    StrCpy $INSTDIR $R0
  ${EndIf}
!macroend