@echo off
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000 > cftunnel.log 2>&1
