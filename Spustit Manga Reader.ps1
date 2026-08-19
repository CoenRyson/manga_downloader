param(
  [int]$Port = 3000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDir = Join-Path $env:LOCALAPPDATA "MangaReaderLocal"
$stdoutLog = Join-Path $stateDir "server.log"
$stderrLog = Join-Path $stateDir "server-error.log"
$downloadStdoutLog = Join-Path $stateDir "download-server.log"
$downloadStderrLog = Join-Path $stateDir "download-server-error.log"

function Test-MangaReader([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match "Manga Reader"
  } catch {
    return $false
  }
}

function Test-PortInUse([int]$CandidatePort) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $CandidatePort -ErrorAction SilentlyContinue)
}

function Test-DownloadServer([int]$CandidatePort) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$CandidatePort/health" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Open-MangaReader([string]$Url) {
  if ($NoBrowser) { return }
  Start-Process $Url
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command -and (Test-Path -LiteralPath $command.Source)) { return $command.Source }

  $programFilesNode = Join-Path $env:ProgramFiles "nodejs\node.exe"
  if (Test-Path -LiteralPath $programFilesNode) { return $programFilesNode }

  $runtimeRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\runtimes\cua_node"
  if (Test-Path -LiteralPath $runtimeRoot) {
    $runtimeNode = Get-ChildItem -Path (Join-Path $runtimeRoot "*\bin\node.exe") -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($runtimeNode) { return $runtimeNode.FullName }
  }

  $legacyRuntime = Join-Path $env:USERPROFILE ".cache\codex-runtimes"
  if (Test-Path -LiteralPath $legacyRuntime) {
    $legacyNode = Get-ChildItem -LiteralPath $legacyRuntime -Filter node.exe -File -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($legacyNode) { return $legacyNode.FullName }
  }

  throw "Node.js was not found. Install Node.js 22 or newer from https://nodejs.org/."
}

try {
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

  $url = "http://localhost:$Port/"
  if (-not (Test-MangaReader $url)) {
    while (Test-PortInUse $Port) {
      $Port += 1
      if ($Port -gt 3010) { throw "Ports 3000 through 3010 are already occupied." }
    }
    $url = "http://localhost:$Port/"

    $nodeExe = Find-Node
    $vinextCli = Join-Path $projectDir "node_modules\vinext\dist\cli.js"
    if (-not (Test-Path -LiteralPath $vinextCli)) {
      throw "Project packages are missing. Run npm install in the Manga Reader folder."
    }

    $vinextCliArgument = "node_modules\vinext\dist\cli.js"
    Start-Process -FilePath $nodeExe `
      -ArgumentList @($vinextCliArgument, "dev", "--host", "127.0.0.1", "--port", [string]$Port) `
      -WorkingDirectory $projectDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput $stdoutLog `
      -RedirectStandardError $stderrLog | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
      Start-Sleep -Milliseconds 500
      if (Test-MangaReader $url) { $ready = $true; break }
    }
    if (-not $ready) { throw "Manga Reader did not start within 60 seconds. Log: $stderrLog" }
  }

  if (-not $nodeExe) { $nodeExe = Find-Node }
  $downloadPort = $Port + 10000
  $downloadEntry = Join-Path $projectDir "scripts\local-download-server.mjs"
  if (-not (Test-Path -LiteralPath $downloadEntry)) { throw "Local download helper is missing: $downloadEntry" }
  if (-not (Test-DownloadServer $downloadPort)) {
    Start-Process -FilePath $nodeExe `
      -ArgumentList @("scripts\local-download-server.mjs", [string]$Port, [string]$downloadPort) `
      -WorkingDirectory $projectDir `
      -WindowStyle Hidden `
      -RedirectStandardOutput $downloadStdoutLog `
      -RedirectStandardError $downloadStderrLog | Out-Null
    $downloadReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      Start-Sleep -Milliseconds 250
      if (Test-DownloadServer $downloadPort) { $downloadReady = $true; break }
    }
    if (-not $downloadReady) { throw "Local download helper did not start. Log: $downloadStderrLog" }
  }

  Open-MangaReader $url
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show(
    $_.Exception.Message,
    "Manga Reader Local - startup error",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
