@echo off
title Siren Update
echo.
echo Updating Siren...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = 'C:\Users\arion\OneDrive\Desktop\arion nigs updated siren 2';" ^
  "if (-not (Test-Path $root)) { $root = 'C:\Users\arion\Desktop\arion nigs updated siren 2' };" ^
  "if (-not (Test-Path $root)) { Write-Host 'ERROR: folder not found'; Read-Host 'Press Enter'; exit 1 };" ^
  "$base = 'https://raw.githubusercontent.com/arionnik15-lab/avamax/cursor/telegram-chat-approve-15a9';" ^
  "$files = @('Siren-CommandCenter/backend/app/routers/chat.py','Siren-CommandCenter/backend/app/services/agent_llm.py','Siren-CommandCenter/backend/app/services/autosend.py','Siren-CommandCenter/backend/app/services/chat_agent.py','Siren-CommandCenter/backend/app/services/deliver.py','Siren-CommandCenter/backend/app/services/fanvue_chat.py','Siren-CommandCenter/backend/app/services/fanvue_client.py','Siren-CommandCenter/backend/app/services/telegram_bot.py','Siren-CommandCenter/frontend/src/app/(app)/chat/inbox/page.tsx','Siren-CommandCenter/frontend/src/app/(app)/posting/accounts/page.tsx');" ^
  "Write-Host \"Folder: $root\"; Write-Host '';" ^
  "foreach ($f in $files) { $dest = Join-Path $root ($f -replace '^Siren-CommandCenter/',''); $dir = Split-Path $dest -Parent; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }; Invoke-WebRequest -Uri \"$base/$f\" -OutFile $dest -UseBasicParsing; Write-Host \"OK $dest\" };" ^
  "Write-Host ''; Write-Host 'DONE. Restart backend + frontend.'; Read-Host 'Press Enter to close'"

if errorlevel 1 (
  echo.
  echo Something failed. Screenshot this window and send it.
  pause
)
