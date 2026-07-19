# Windows-side bootstrap for Foreman reference environment.
# Usage: .\env\bootstrap-windows.ps1 [-Profile soft|hard|full|durable] [-Yes]
# Installs missing host tools via winget/npm where possible, runs install.ps1,
# then optionally bootstraps WSL for hard/full profiles.
param(
  [ValidateSet("soft", "hard", "full", "durable")]
  [string]$Profile = "soft",
  [switch]$Yes
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Log($m) { Write-Host "[foreman-bootstrap] $m" }

if (-not $Yes) {
  Log "Will install missing tools for profile=$Profile (winget/npm/WSL as needed)."
  $ans = Read-Host "Continue? [y/N]"
  if ($ans -notmatch '^[Yy]$') { Log "aborted"; exit 0 }
}

function Have($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function WingetInstall($Id) {
  if (-not (Have winget)) {
    Log "WARN: winget not available; install $Id manually"
    return
  }
  Log "winget install $Id"
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements
}

function ScoopInstall($Package) {
  if (-not (Have scoop)) {
    Log "WARN: scoop not available; install $Package manually"
    return
  }
  Log "scoop install $Package"
  & scoop install $Package
}

if (-not (Have git)) { WingetInstall "Git.Git" } else { Log "git OK" }

$pyOk = $false
foreach ($py in @("python3", "python")) {
  if (Have $py) {
    & $py -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) { $pyOk = $true; Log "$py OK"; break }
  }
}
if (-not $pyOk) { WingetInstall "Python.Python.3.12" }

if (-not (Have node) -or -not (Have npm)) {
  WingetInstall "OpenJS.NodeJS.LTS"
  # refresh PATH in this session is imperfect; continue
} else { Log "node/npm OK" }

# Durable-lanes dependencies and optional NATS transport.
if ($Profile -eq "durable") {
  if (-not (Have jq)) { ScoopInstall "main/jq" } else { Log "jq OK" }
  if (-not (Have stdbuf) -and -not (Have gstdbuf)) { ScoopInstall "main/coreutils" } else { Log "coreutils/stdbuf OK" }
  if (-not (Have nats-server)) { ScoopInstall "main/nats-server" } else { Log "nats-server OK" }
  if (-not (Have nats)) { ScoopInstall "extras/natscli" } else { Log "nats CLI OK" }
}

# Documentation tools (soft/full docs group)
if ($Profile -in @("soft", "full")) {
  if (-not (Have markdownlint-cli2)) {
    if (Have npm) {
      Log "npm install -g markdownlint-cli2"
      npm install -g markdownlint-cli2
    } else {
      Log "WARN: npm missing — cannot install markdownlint-cli2 yet"
    }
  } else { Log "markdownlint-cli2 OK" }

  $codespellOk = $false
  if (Have codespell) {
    & codespell --version 2>$null
    $codespellOk = ($LASTEXITCODE -eq 0)
  }
  if (-not $codespellOk) {
    foreach ($py in @("python3", "python")) {
      if (Have $py) {
        & $py -m codespell_lib --version 2>$null
        if ($LASTEXITCODE -eq 0) { $codespellOk = $true; break }
      }
    }
  }
  if (-not $codespellOk) {
    if (Have pip) {
      Log "pip install --user codespell"
      pip install --user codespell
    } else {
      Log "WARN: pip missing — cannot install codespell yet"
    }
  } else { Log "codespell OK (CLI or Python module)" }

  if (-not (Have lychee)) { WingetInstall "lycheeverse.lychee" } else { Log "lychee OK" }

  if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
    Log "Install-Module PSScriptAnalyzer"
    Install-Module -Name PSScriptAnalyzer -Scope CurrentUser -Force
  } else { Log "PSScriptAnalyzer OK" }
}

if (-not (Have codex)) {
  if (Have npm) {
    Log "npm install -g @openai/codex"
    npm install -g @openai/codex
  } else {
    Log "WARN: npm missing — cannot install codex yet; re-open shell after Node install"
  }
} else { Log "codex OK: $(codex --version 2>&1 | Select-Object -First 1)" }

if (-not (Have grok)) {
  Log "MISSING grok — install Grok Build from https://x.ai/cli then: grok login"
} else { Log "grok OK" }

if (-not (Have claude)) {
  Log "OPTIONAL claude — install Claude Code from https://code.claude.com"
} else { Log "claude OK" }

if (-not (Have gh) -and $Profile -in @("hard", "full")) {
  WingetInstall "GitHub.cli"
}

# Foreman skill install
$installPs1 = Join-Path $Root "install.ps1"
if (Test-Path $installPs1) {
  Log "running install.ps1"
  powershell -ExecutionPolicy Bypass -File $installPs1
}

New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE ".foreman\runs") | Out-Null

# WSL path for hard/full
if ($Profile -in @("hard", "full")) {
  if (-not (Have wsl)) {
    Log "WSL not installed. Run elevated: wsl --install  (or use C:\Users\charl\wsl-setup\1-windows-bootstrap.ps1)"
    Log "After Ubuntu exists, run inside WSL: bash env/bootstrap-wsl.sh --profile $Profile --yes"
  } else {
    Log "Invoking WSL bootstrap for profile=$Profile"
    $drive = $Root.Substring(0, 1).ToLower()
    $rest = $Root.Substring(2) -replace '\\', '/'
    $wslRoot = "/mnt/$drive/$rest"
    & wsl -e bash -lc "cd '$wslRoot' && bash env/bootstrap-wsl.sh --profile $Profile --yes"
    if ($LASTEXITCODE -ne 0) {
      Log "WARN: WSL bootstrap exited $LASTEXITCODE"
    }
  }
}

Log "re-running tool-check..."
$out = Join-Path $env:USERPROFILE ".foreman\last-tool-check.json"
powershell -ExecutionPolicy Bypass -File (Join-Path $Root "env\tool-check.ps1") -Profile $Profile -Json -Out $out
Log "bootstrap finished. Auth if needed: grok login ; codex login"
Log "tool-check: $out"
