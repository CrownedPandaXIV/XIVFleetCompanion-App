; Added to the Windows installer by electron-builder (build/installer.nsh is picked up on its own).
;
; Uninstalling the app also removes the scheduled tasks it set up on this PC: the daily backup and the Discord
; alerts. Both start the app, so with it gone they would only fail quietly. PostgreSQL, the database, Tailscale,
; the app's settings and backup files all stay. An update also runs the old version's uninstaller (with
; --updated), and the tasks are kept then. The names match TASK_NAME in backups/schedule.js and
; alerts/schedule.js (tests/installer-script.test.js checks).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN "XIV Fleet Companion backup" /F'
    Pop $0
    nsExec::Exec '"$SYSDIR\schtasks.exe" /Delete /TN "Fleet Companion alerts" /F'
    Pop $0
  ${endIf}
!macroend
