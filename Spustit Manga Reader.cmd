@echo off
setlocal
set "PROJECT_DIR=D:\codex\manga-vault"
set "PNPM_CMD=C:\Users\Daniel Sýkora\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd"
set "NODE_BIN=C:\Users\Daniel Sýkora\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$running = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if (-not $running) { $env:Path = '%NODE_BIN%;' + $env:Path; Start-Process -WindowStyle Hidden -FilePath '%PNPM_CMD%' -ArgumentList 'run','dev' -WorkingDirectory '%PROJECT_DIR%'; Start-Sleep -Seconds 3 }; Start-Process 'http://localhost:3000/'"

endlocal
