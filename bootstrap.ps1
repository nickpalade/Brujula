# Brujula bootstrap (Windows). Installs Ollama, pulls the model, starts and
# verifies the server. Needs internet ONCE (install + model pull); after that
# everything runs offline.
#
# Run:  powershell -ExecutionPolicy Bypass -File bootstrap.ps1

# ── TWEAK: model + endpoint ─────────────────────────────────────────────
$MODEL = "gemma3n:e4b"   # the model the demo + verify runs use (multimodal)
$OLLAMA_URL = "http://localhost:11434"

$ErrorActionPreference = "Stop"

# Node >= 22.5 required (server uses the built-in node:sqlite).
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "FAILURE: Node.js not found. Install Node 22.5+ (https://nodejs.org) and re-run."
    exit 1
}
$nodeVer = (node --version) -replace '^v', ''
$nv = [Version]$nodeVer
if ($nv -lt [Version]"22.5.0") {
    Write-Host "FAILURE: Node $nodeVer found, but the server needs >= 22.5.0 (built-in node:sqlite)."
    Write-Host "Upgrade Node, then re-run."
    exit 1
}
Write-Host "Node $nodeVer OK."

function Test-OllamaServer {
    try {
        $resp = Invoke-WebRequest -Uri "$OLLAMA_URL/api/version" -UseBasicParsing -TimeoutSec 3
        return $resp.StatusCode -eq 200
    } catch { return $false }
}

function Find-Ollama {
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe"
    )
    foreach ($p in $candidates) { if (Test-Path $p) { return $p } }
    return $null
}

Write-Host "[1/4] Checking Ollama installation..."
$ollamaExe = Find-Ollama
if (-not $ollamaExe) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Host "FAILURE: Ollama is not installed and winget is unavailable."
        Write-Host "Install it manually, then re-run this script:"
        Write-Host "    winget install --id Ollama.Ollama"
        Write-Host "    (or download from https://ollama.com/download/windows)"
        exit 1
    }
    Write-Host "  Ollama not found. Installing via winget (this downloads ~1 GB)..."
    winget install --id Ollama.Ollama --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILURE: winget install failed (exit $LASTEXITCODE)."
        Write-Host "Install manually: winget install --id Ollama.Ollama"
        exit 1
    }
    # The installer does not update this session's PATH; add known locations.
    $env:Path = "$env:LOCALAPPDATA\Programs\Ollama;$env:Path"
    $ollamaExe = Find-Ollama
    if (-not $ollamaExe) {
        Write-Host "FAILURE: install finished but ollama.exe not found. Open a new terminal and re-run."
        exit 1
    }
}
Write-Host "  Found: $ollamaExe"
$ollamaDir = Split-Path $ollamaExe
if ($env:Path -notlike "*$ollamaDir*") { $env:Path = "$ollamaDir;$env:Path" }

# Brujula embeds Ollama (spawns `ollama serve` itself); the desktop app is
# not used. Remove the installer's autostart shortcut and close the tray app.
$autostart = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
if (Test-Path $autostart) {
    Remove-Item $autostart -Confirm:$false
    Write-Host "  Removed Ollama desktop app autostart (Brujula manages the server itself)."
}
Get-Process -Name "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false

Write-Host "[2/4] Checking Ollama server on $OLLAMA_URL ..."
if (-not (Test-OllamaServer)) {
    Write-Host "  Not running. Starting 'ollama serve' in the background..."
    Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
    $up = $false
    foreach ($i in 1..30) {
        Start-Sleep -Seconds 1
        if (Test-OllamaServer) { $up = $true; break }
    }
    if (-not $up) {
        Write-Host "FAILURE: Ollama server did not respond on $OLLAMA_URL after 30s."
        exit 1
    }
}
Write-Host "  Server responding."

Write-Host "[3/4] Checking model '$MODEL' ..."
$tags = (Invoke-WebRequest -Uri "$OLLAMA_URL/api/tags" -UseBasicParsing).Content | ConvertFrom-Json
$have = $false
foreach ($m in $tags.models) { if ($m.name -eq $MODEL) { $have = $true } }
if (-not $have) {
    Write-Host "  Not present. Pulling (several GB, needs internet, one time only)..."
    & $ollamaExe pull $MODEL
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILURE: 'ollama pull $MODEL' failed (exit $LASTEXITCODE)."
        exit 1
    }
} else {
    Write-Host "  Already pulled."
}

Write-Host "[4/4] Final verification..."
$tags = (Invoke-WebRequest -Uri "$OLLAMA_URL/api/tags" -UseBasicParsing).Content | ConvertFrom-Json
$names = @($tags.models | ForEach-Object { $_.name })
if ((Test-OllamaServer) -and ($names -contains $MODEL)) {
    Write-Host ""
    Write-Host "SUCCESS: Ollama running on $OLLAMA_URL with model $MODEL. Fully offline from here."
    Write-Host "Next:  npm install; npm start"
    exit 0
} else {
    Write-Host ""
    Write-Host "FAILURE: server or model check failed. Models present: $($names -join ', ')"
    exit 1
}
