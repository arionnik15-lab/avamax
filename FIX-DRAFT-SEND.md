# Fix: Siren “Approve and send” not delivering to Fanvue

## Cause

Siren was calling the **wrong Fanvue URL**:

- Wrong: `POST /chats/{fanUuid}/messages` (list endpoint)
- Correct: `POST /chats/{fanUuid}/message` (send endpoint)

That is why sync/Telegram drafts worked (`GET .../messages`) but Approve never appeared in Fanvue.

## Fix on your Windows PC (do this now)

1. Open this file in Notepad:

   `C:\Users\arion\OneDrive\Desktop\Siren-CommandCenter-friend\backend\app\services\fanvue_chat.py`

2. Find this line near the bottom of `send_message`:

   ```python
   return await fanvue_client.request("POST", f"/chats/{fan_uuid}/messages", json=body, key=key)
   ```

3. Change it to (**message**, not **messages**):

   ```python
   return await fanvue_client.request("POST", f"/chats/{fan_uuid}/message", json=body, key=key)
   ```

4. Save the file.

5. Restart the **backend** PowerShell window (Ctrl+C, then):

   ```powershell
   cd C:\Users\arion\OneDrive\Desktop\Siren-CommandCenter-friend\backend
   .\.venv\Scripts\python.exe run.py
   ```

6. Open Inbox → open the draft → **Approve and send** again.

If the draft already shows as “sent” in Siren but never hit Fanvue, click regenerate (or wait for a new inbound) and approve the new draft.
