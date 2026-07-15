# Foreman reference-env inventory (Windows host).
# Usage: .\env\tool-check.ps1 [-Profile soft|hard|full] [-Json] [-Out path]
param(
  [ValidateSet("soft", "hard", "full")]
  [string]$Profile = "soft",
  [switch]$Json,
  [string]$Out = ""
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $Root) { $Root = (Get-Location).Path }
$Now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

function Test-Cmd([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Ver([string]$Name, [string]$Arg = "--version") {
  try {
    $argList = $Arg.Split(" ")
    $out = & $Name @argList 2>&1 | Out-String
    return (($out -split "`n")[0]).Trim()
  } catch {
    return ""
  }
}

function Check-One([string]$Id) {
  $status = "missing"
  $detail = ""
  switch ($Id) {
    "git" {
      if (Test-Cmd "git") { $status = "ok"; $detail = Get-Ver "git" }
    }
    "python3" {
      $py = $null
      if (Test-Cmd "python3") { $py = "python3" }
      elseif (Test-Cmd "python") { $py = "python" }
      if ($py) {
        $detail = Get-Ver $py
        try {
          & $py -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" 2>$null
          if ($LASTEXITCODE -eq 0) {
            & $py -c "import tomllib" 2>$null
            if ($LASTEXITCODE -eq 0) { $status = "ok" }
            else { $status = "outdated"; $detail = "$detail (tomllib missing)" }
          } else {
            $status = "outdated"
            $detail = "$detail (need >= 3.11)"
          }
        } catch {
          $status = "outdated"
        }
      }
    }
    "jq" {
      if (Test-Cmd "jq") { $status = "ok"; $detail = Get-Ver "jq" }
    }
    "grok" {
      if (Test-Cmd "grok") { $status = "ok"; $detail = Get-Ver "grok" }
    }
    "codex" {
      if (Test-Cmd "codex") { $status = "ok"; $detail = Get-Ver "codex" }
    }
    "claude" {
      if (Test-Cmd "claude") { $status = "ok"; $detail = Get-Ver "claude" }
    }
    "node" {
      if (Test-Cmd "node") { $status = "ok"; $detail = Get-Ver "node" }
    }
    "npm" {
      if (Test-Cmd "npm") { $status = "ok"; $detail = Get-Ver "npm" "-v" }
    }
    "docker" {
      if (Test-Cmd "docker") {
        $status = "degraded"
        $detail = "docker on Windows PATH - hard mode expects docker inside WSL"
      } else {
        $status = "missing"
        $detail = "use WSL docker-ce (bootstrap-wsl.sh)"
      }
    }
    "gh" {
      if (Test-Cmd "gh") { $status = "ok"; $detail = Get-Ver "gh" }
    }
    "wsl" {
      if (Test-Cmd "wsl") {
        $list = (& wsl -l -q 2>&1 | Out-String) -replace "`0", ""
        if ($LASTEXITCODE -eq 0 -and $list.Trim().Length -gt 0) {
          $status = "ok"
          $detail = ($list.Trim() -replace "\s+", ", ")
        } else {
          $status = "degraded"
          $detail = "wsl present but no distros listed"
        }
      }
    }
    "foreman_skill" {
      $p1 = Join-Path $env:USERPROFILE ".claude\skills\foreman\SKILL.md"
      $p2 = Join-Path $env:USERPROFILE ".agents\skills\foreman\SKILL.md"
      $p3 = Join-Path $env:USERPROFILE ".grok\skills\foreman\SKILL.md"
      if ((Test-Path $p1) -or (Test-Path $p2) -or (Test-Path $p3)) {
        $status = "ok"
        $detail = "skill linked under user skills homes"
      } elseif (Test-Path (Join-Path $Root "skills\foreman\SKILL.md")) {
        $status = "degraded"
        $detail = "repo present; run install.ps1"
      }
    }
    default {
      $status = "unknown"
      $detail = "no checker"
    }
  }
  return [pscustomobject]@{ id = $Id; status = $status; detail = $detail }
}

$mustSoft = @("git", "python3", "grok", "codex", "foreman_skill")
$mustHard = @("wsl", "git", "python3", "foreman_skill")
$mustFull = @("wsl", "git", "python3", "grok", "codex", "foreman_skill")
$shouldSoft = @("claude", "node", "npm", "jq")
$shouldHard = @("gh")
$shouldFull = @("claude", "node", "npm", "jq", "gh", "docker")

switch ($Profile) {
  "soft" { $must = $mustSoft; $should = $shouldSoft }
  "hard" { $must = $mustHard; $should = $shouldHard }
  "full" { $must = $mustFull; $should = $shouldFull }
}

$ids = @()
foreach ($x in ($must + $should)) {
  if ($ids -notcontains $x) { $ids += $x }
}

$tools = @()
foreach ($id in $ids) {
  $tools += (Check-One $id)
}

$mustFail = @()
foreach ($m in $must) {
  $t = $tools | Where-Object { $_.id -eq $m } | Select-Object -First 1
  if (-not $t -or $t.status -ne "ok") {
    $st = if ($t) { $t.status } else { "missing" }
    $mustFail += "${m}:${st}"
  }
}
$ready = ($mustFail.Count -eq 0)

$wslReport = $null
if ($Profile -in @("hard", "full") -and (Test-Cmd "wsl")) {
  $drive = $Root.Substring(0, 1).ToLower()
  $rest = $Root.Substring(2) -replace '\\', '/'
  $wslPath = "/mnt/$drive/$rest/env/tool-check.sh"
  try {
    $wslOut = & wsl -e bash -lc "bash '$wslPath' --profile $Profile --json" 2>&1 | Out-String
    if ($wslOut -match '"schema"') {
      $wslReport = $wslOut
      if ($wslOut -match '"ready"\s*:\s*false') {
        $ready = $false
        $mustFail += "wsl-profile:not-ready"
      }
    }
  } catch {
    $mustFail += "wsl-tool-check:error"
    $ready = $false
  }
}

$missing = @($tools | Where-Object { $_.status -eq "missing" } | ForEach-Object { $_.id })
$outdated = @($tools | Where-Object { $_.status -eq "outdated" } | ForEach-Object { $_.id })
$degraded = @($tools | Where-Object { $_.status -eq "degraded" } | ForEach-Object { $_.id })

if ($Json) {
  $obj = [ordered]@{
    schema     = "foreman.tool-check.v1"
    profile    = $Profile
    ready      = [bool]$ready
    host       = $env:COMPUTERNAME
    os         = "windows"
    wsl        = [bool](Test-Cmd "wsl")
    time       = $Now
    repo       = $Root
    tools      = $tools
    missing    = $missing
    outdated   = $outdated
    degraded   = $degraded
    must_fail  = $mustFail
    next       = @(
      if (-not $ready) {
        "powershell -ExecutionPolicy Bypass -File env\bootstrap-windows.ps1 -Profile $Profile -Yes"
        "wsl: bash env/bootstrap-wsl.sh --profile $Profile --yes"
      } else {
        "proceed with /foreman"
      }
    )
  }
  $body = ($obj | ConvertTo-Json -Depth 6)
} else {
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add("FOREMAN TOOL CHECK")
  [void]$lines.Add("profile: $Profile")
  [void]$lines.Add("host: $env:COMPUTERNAME  os: windows  wsl: $(Test-Cmd 'wsl')")
  [void]$lines.Add("time: $Now")
  [void]$lines.Add("repo: $Root")
  [void]$lines.Add("---")
  [void]$lines.Add(("{0,-16} {1,-10} {2}" -f "TOOL", "STATUS", "DETAIL"))
  foreach ($t in $tools) {
    [void]$lines.Add(("{0,-16} {1,-10} {2}" -f $t.id, $t.status, $t.detail))
  }
  [void]$lines.Add("---")
  if ($ready) {
    [void]$lines.Add("READY: yes - profile '$Profile' must-tools are OK on Windows host")
  } else {
    [void]$lines.Add("READY: no - fix must-tools before implementation work")
    [void]$lines.Add("MUST_FAIL: $($mustFail -join ' ')")
  }
  if ($missing.Count) { [void]$lines.Add("MISSING: $($missing -join ' ')") }
  if ($outdated.Count) { [void]$lines.Add("OUTDATED: $($outdated -join ' ')") }
  if ($degraded.Count) { [void]$lines.Add("DEGRADED: $($degraded -join ' ')") }
  [void]$lines.Add("---")
  [void]$lines.Add("NEXT:")
  if (-not $ready) {
    [void]$lines.Add("  powershell -ExecutionPolicy Bypass -File env\bootstrap-windows.ps1 -Profile $Profile -Yes")
    [void]$lines.Add("  # hard/full also: wsl bash env/bootstrap-wsl.sh --profile $Profile --yes")
  } else {
    [void]$lines.Add("  proceed with /foreman soft or hard implementation")
  }
  if ($wslReport) {
    [void]$lines.Add("---")
    [void]$lines.Add("WSL NESTED CHECK:")
    [void]$lines.Add($wslReport.Trim())
  }
  $body = ($lines -join "`n")
}

Write-Output $body
if ($Out) {
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  Set-Content -Path $Out -Value $body -Encoding UTF8
  Write-Host "[tool-check] wrote $Out"
}

if ($ready) { exit 0 } else { exit 1 }
