# Updates Siren fix files from GitHub (telegram-chat-approve branch).
# Default folder: Desktop\arion nigs updated siren

$root = "C:\Users\arion\OneDrive\Desktop\arion nigs updated siren 2"
if (-not (Test-Path $root)) {
    $alt = "C:\Users\arion\Desktop\arion nigs updated siren 2"
    if (Test-Path $alt) { $root = $alt }
    else {
        Write-Host "Folder not found. Edit `$root in this script to your Siren path."
        exit 1
    }
}

$base = "https://raw.githubusercontent.com/arionnik15-lab/avamax/cursor/telegram-chat-approve-15a9"

$files = @(
    "Siren-CommandCenter/backend/app/routers/chat.py",
    "Siren-CommandCenter/backend/app/services/agent_llm.py",
    "Siren-CommandCenter/backend/app/services/autosend.py",
    "Siren-CommandCenter/backend/app/services/chat_agent.py",
    "Siren-CommandCenter/backend/app/services/deliver.py",
    "Siren-CommandCenter/backend/app/services/fanvue_chat.py",
    "Siren-CommandCenter/backend/app/services/fanvue_client.py",
    "Siren-CommandCenter/backend/app/services/telegram_bot.py",
    "Siren-CommandCenter/frontend/src/app/(app)/chat/inbox/page.tsx",
    "Siren-CommandCenter/frontend/src/app/(app)/posting/accounts/page.tsx"
)

Write-Host "Updating Siren in: $root"
Write-Host ""

foreach ($f in $files) {
    $dest = Join-Path $root ($f -replace "^Siren-CommandCenter/", "")
    $dir = Split-Path $dest -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    try {
        Invoke-WebRequest -Uri "$base/$f" -OutFile $dest -UseBasicParsing
        Write-Host "OK  $dest"
    }
    catch {
        Write-Host "FAIL $f"
        Write-Host $_.Exception.Message
        exit 1
    }
}

Write-Host ""
Write-Host "Done. Restart backend + frontend:"
Write-Host '  cd "' + $root + '\backend"; .\.venv\Scripts\python.exe run.py'
Write-Host '  cd "' + $root + '\frontend"; npm.cmd run dev'
Write-Host "  Open http://localhost:3030"
