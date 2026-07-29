# Foreman reference-env inventory (Windows host).
# Usage: .\env\tool-check.ps1 [-Profile soft|hard|full|durable] [-Json] [-Out path]
param(
  [ValidateSet("soft", "hard", "full", "durable")]
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

function Get-NormalizedPath([string]$Path, [string]$BasePath = "") {
  if ($BasePath -and -not [System.IO.Path]::IsPathRooted($Path)) {
    $Path = Join-Path $BasePath $Path
  }
  try {
    return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path.TrimEnd("\")
  } catch {
    return [System.IO.Path]::GetFullPath($Path).TrimEnd("\")
  }
}

$CommonSkillsRoot = $null
if (Get-Command git -ErrorAction SilentlyContinue) {
  $commonDir = (& git -C $Root rev-parse --path-format=absolute --git-common-dir 2>$null | Select-Object -First 1)
  if ($commonDir -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $commonDir) "skills"))) {
    $CommonSkillsRoot = Get-NormalizedPath (Join-Path (Split-Path -Parent $commonDir) "skills")
  }
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
    "coreutils" {
      if (Test-Cmd "stdbuf") { $status = "ok"; $detail = Get-Ver "stdbuf" }
      elseif (Test-Cmd "gstdbuf") { $status = "ok"; $detail = Get-Ver "gstdbuf" }
    }
    "bash" {
      if (Test-Cmd "bash") { $status = "ok"; $detail = Get-Ver "bash" }
    }
    "nats-server" {
      if (Test-Cmd "nats-server") { $status = "ok"; $detail = Get-Ver "nats-server" }
    }
    "nats-cli" {
      if (Test-Cmd "nats") { $status = "ok"; $detail = Get-Ver "nats" }
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
    "markdownlint-cli2" {
      if (Test-Cmd "markdownlint-cli2") { $status = "ok"; $detail = Get-Ver "markdownlint-cli2" }
    }
    "codespell" {
      if (Test-Cmd "codespell") {
        $version = & codespell --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { $status = "ok"; $detail = $version.Trim() }
      }
      if ($status -ne "ok") {
        foreach ($py in @("python3", "python")) {
          if (Test-Cmd $py) {
            $version = & $py -m codespell_lib --version 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
              $status = "ok"
              $detail = "$py -m codespell_lib $($version.Trim())"
              break
            }
          }
        }
      }
    }
    "bun" {
      if (Test-Cmd "bun") {
        $detail = Get-Ver "bun"
        if ($detail -eq "1.3.14") {
          $status = "ok"
        } else {
          $status = "outdated"
          $detail = "$detail (expected 1.3.14 pin; winget does not self-pin)"
        }
      }
    }
    "pueue" {
      if (Test-Cmd "pueue") {
        $status = "ok"; $detail = Get-Ver "pueue"
      } else {
        $staged = Join-Path $env:USERPROFILE ".foreman\tools\pueue\pueue.exe"
        if (Test-Path $staged) {
          $status = "ok"
          $detail = (($(& $staged --version 2>&1) | Out-String) -split "`n")[0].Trim()
        }
      }
    }
    "lychee" {
      $lycheeCmd = $env:LYCHEE
      if (-not $lycheeCmd -and (Test-Cmd "lychee")) {
        $lycheeCmd = (Get-Command "lychee" -ErrorAction SilentlyContinue).Source
      }
      if (-not $lycheeCmd -and $env:LOCALAPPDATA) {
        $link = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\lychee.exe"
        if (Test-Path $link) { $lycheeCmd = $link }
      }
      if (-not $lycheeCmd -and $env:LOCALAPPDATA) {
        $packagePattern = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\lycheeverse.lychee*\*\lychee.exe"
        $packageExe = Get-ChildItem -Path $packagePattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($packageExe) { $lycheeCmd = $packageExe.FullName }
      }
      if ($lycheeCmd) {
        $version = & $lycheeCmd --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0) { $status = "ok"; $detail = $version.Trim() }
      }
    }
    "psscriptanalyzer" {
      $module = Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1
      if ($module) { $status = "ok"; $detail = "PSScriptAnalyzer $($module.Version)" }
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
    "flock" {
      if (Test-Cmd "flock") {
        $status = "ok"
        $detail = Get-Ver "flock"
        if (-not $detail) { $detail = "flock present" }
      } else {
        # Git-Bash/MSYS: flock is typically absent; durable may use pinned mkdir.
        $status = "missing"
        $detail = "flock not on PATH (expected on Git-Bash; mkdir pinned-mechanism is the fallback)"
      }
    }
    default {
      $status = "unknown"
      $detail = "no checker"
    }
  }
  return [pscustomobject]@{ id = $Id; status = $status; detail = $detail }
}


# --- Lock atomicity probe (T4 mirror). PS1 is NOT required to produce syscall
# evidence — that is what pinned-mechanism exists for. Without a tracer, report
# weaker class honestly and verdict unknown (never atomic from flavour alone).
function Get-FsClass([string]$Path) {
  if ($Path -match '^//|^\\\\') { return "network" }
  try {
    $full = [System.IO.Path]::GetFullPath($Path)
  } catch { $full = $Path }
  # Drive-letter local fixed volume vs UNC
  if ($full -match '^[A-Za-z]:\\') { return "local" }
  if ($full -match '^\\\\') { return "network" }
  return "local"
}

function Get-FileSha256([string]$FilePath) {
  if (-not $FilePath -or -not (Test-Path -LiteralPath $FilePath)) { return "" }
  try {
    return (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
  } catch { return "" }
}

function Get-HostClassForPin {
  # Mirror lock.sh host classes for pin provenance.
  if ($env:FOREMAN_LOCK_HOST_CLASS) { return $env:FOREMAN_LOCK_HOST_CLASS }
  if ($env:MSYSTEM -or $env:MSYSTEM_CARCH) { return "msys2-git-bash" }
  if ($IsWindows -or $env:OS -match "Windows") { return "msys2-git-bash" }
  return "msys2-git-bash"
}

function Test-TraceArtifactValid([string]$Mech, [string]$TracePath) {
  if (-not $TracePath -or -not (Test-Path -LiteralPath $TracePath)) { return $false }
  try {
    $content = Get-Content -LiteralPath $TracePath -Raw -ErrorAction Stop
  } catch { return $false }
  if (-not $content) { return $false }
  if ($Mech -eq "mkdir") {
    if ($content -match 'mkdir(at)?\([^)]*\)\s*=\s*-1\s+EEXIST') { return $true }
    if ($content -match 'ERROR_ALREADY_EXISTS') { return $true }
    return $false
  }
  if ($Mech -eq "flock") {
    $loser = $content -match 'flock\([^)]*LOCK_EX[^)]*LOCK_NB[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)' -or
             $content -match 'flock\([^)]*LOCK_NB[^)]*LOCK_EX[^)]*\)\s*=\s*-1\s+(EAGAIN|EWOULDBLOCK)'
    $holder = $content -match 'flock\([^)]*LOCK_EX[^)]*\)\s*=\s*0' -or
              $content -match 'holder_acquired=1' -or
              $content -match 'HOLDER_PROCEEDED'
    return ($loser -and $holder)
  }
  return $false
}

function Get-PinnedVerdict([string]$Mech, [string]$Sha) {
  # F5/F9: read register; require host_class match + valid trace artifact.
  if (-not $Sha) { return $null }
  $manifest = Join-Path $Root "env\reference-manifest.toml"
  if ($env:FOREMAN_LOCK_MANIFEST -and (Test-Path -LiteralPath $env:FOREMAN_LOCK_MANIFEST)) {
    $manifest = $env:FOREMAN_LOCK_MANIFEST
  }
  if (-not (Test-Path -LiteralPath $manifest)) { return $null }
  $hostNow = Get-HostClassForPin
  try {
    $raw = Get-Content -LiteralPath $manifest -Raw
  } catch { return $null }
  # Minimal TOML walk for [[lock_atomicity.pinned]] tables
  $blocks = [regex]::Split($raw, '(?=\[\[lock_atomicity\.pinned\]\])')
  foreach ($b in $blocks) {
    if ($b -notmatch '\[\[lock_atomicity\.pinned\]\]') { continue }
    $mMech = if ($b -match 'mechanism\s*=\s*"([^"]+)"') { $Matches[1] } else { "" }
    $mSha = if ($b -match 'sha256\s*=\s*"([^"]+)"') { $Matches[1] } else { "" }
    if ($mMech -ne $Mech) { continue }
    if ($mSha.ToLowerInvariant() -ne $Sha.ToLowerInvariant()) { continue }
    $mHost = if ($b -match 'host_class\s*=\s*"([^"]+)"') { $Matches[1] } else { "" }
    if (-not $mHost -or $mHost -ne $hostNow) { continue }
    $mTrace = if ($b -match 'trace_artifact\s*=\s*"([^"]+)"') { $Matches[1] } else { "" }
    if (-not $mTrace) { continue }
    $mVerdict = if ($b -match 'verdict\s*=\s*"([^"]+)"') { $Matches[1] } else { "" }
    if ($mVerdict -notin @("atomic", "non-atomic")) { continue }
    $tracePath = $mTrace
    if (-not [System.IO.Path]::IsPathRooted($tracePath)) {
      $tracePath = Join-Path $Root ($mTrace -replace '/', '\')
    }
    if (-not (Test-TraceArtifactValid $Mech $tracePath)) { continue }
    $classes = @()
    if ($b -match 'filesystem_classes\s*=\s*\[([^\]]+)\]') {
      $inner = $Matches[1]
      foreach ($cm in [regex]::Matches($inner, '"([^"]+)"')) {
        $classes += $cm.Groups[1].Value
      }
    }
    if ($classes.Count -eq 0) { $classes = @("local") }
    return [pscustomobject]@{
      verdict = $mVerdict
      filesystem_classes = $classes
      evidence_class = "pinned-mechanism"
      trace = $mTrace
    }
  }
  return $null
}

function Get-LockAtomicityProbe {
  $ts = $Now
  $rows = @()
  $info = @()
  $trustedAtomic = $false

  # mkdir — Git-Bash / MSYS may expose mkdir.exe; also try where.exe
  $mkdirCmd = $null
  foreach ($name in @("mkdir.exe", "mkdir")) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c) { $mkdirCmd = $c; break }
  }
  if ($mkdirCmd) {
    $mkdirPath = $mkdirCmd.Source
    if (-not $mkdirPath) { $mkdirPath = $mkdirCmd.Path }
    $ver = ""
    try {
      $verOut = & $mkdirPath --version 2>&1 | Out-String
      $ver = (($verOut -split "`n")[0]).Trim()
    } catch { $ver = "mkdir" }
    $sha = Get-FileSha256 $mkdirPath
    $fs = Get-FsClass (Split-Path -Parent $mkdirPath)
    # No Windows strace analogue required here. Flavour alone cannot license atomic.
    $verdict = "unknown"
    $evidence = "flavour"
    $classes = @($fs)
    $notes = "Windows/Git-Bash host: no syscall tracer in PS1 mirror; flavour alone licenses nothing; use pinned-mechanism register for mkdir trust"
    # F5: consult pinned register — real pin makes mkdir fallback reachable
    $pin = Get-PinnedVerdict "mkdir" $sha
    if ($pin) {
      $verdict = $pin.verdict
      $evidence = $pin.evidence_class
      $classes = @($pin.filesystem_classes)
      $notes = "pinned-mechanism from register (host_class match + validated trace); fallback reachable"
      if ($verdict -eq "atomic") { $trustedAtomic = $true }
    }
    $rows += [pscustomobject]@{
      mechanism = "mkdir"
      path = $mkdirPath
      version = $ver
      sha256 = $sha
      verdict = $verdict
      evidence_class = $evidence
      filesystem_classes = $classes
      timestamp = $ts
      notes = $notes
    }
  } else {
    $rows += [pscustomobject]@{
      mechanism = "mkdir"
      path = ""
      version = ""
      sha256 = ""
      verdict = "unknown"
      evidence_class = "flavour"
      filesystem_classes = @()
      timestamp = $ts
      notes = "mkdir not found on Windows PATH"
    }
  }

  # flock — typically absent on pure Windows; present under some environments
  $flockCmd = Get-Command "flock" -ErrorAction SilentlyContinue
  if ($flockCmd) {
    $flockPath = $flockCmd.Source
    if (-not $flockPath) { $flockPath = $flockCmd.Path }
    $sha = Get-FileSha256 $flockPath
    $fs = Get-FsClass (Split-Path -Parent $flockPath)
    $verdict = "unknown"
    $evidence = "flavour"
    $classes = @($fs)
    $notes = "PS1 mirror: flock present but no syscall evidence produced here; verdict unknown (not atomic)"
    $pin = Get-PinnedVerdict "flock" $sha
    if ($pin) {
      $verdict = $pin.verdict
      $evidence = $pin.evidence_class
      $classes = @($pin.filesystem_classes)
      $notes = "pinned-mechanism from register"
      if ($verdict -eq "atomic") { $trustedAtomic = $true }
    }
    $rows += [pscustomobject]@{
      mechanism = "flock"
      path = $flockPath
      version = "flock"
      sha256 = $sha
      verdict = $verdict
      evidence_class = $evidence
      filesystem_classes = $classes
      timestamp = $ts
      notes = $notes
    }
  } else {
    $rows += [pscustomobject]@{
      mechanism = "flock"
      path = ""
      version = ""
      sha256 = ""
      verdict = "unknown"
      evidence_class = "flavour"
      filesystem_classes = @()
      timestamp = $ts
      notes = "flock not on Windows PATH (expected for Git-Bash; mkdir fallback uses pinned-mechanism)"
    }
  }

  return [pscustomobject]@{
    rows = $rows
    trustedAtomic = $trustedAtomic
    info = $info
  }
}


$mustSoft = @("git", "python3", "grok", "codex", "foreman_skill")
$mustHard = @("wsl", "git", "python3", "foreman_skill")
$mustFull = @("wsl", "git", "python3", "grok", "codex", "foreman_skill")
$mustDurable = @("git", "jq", "coreutils", "bash", "flock")
$shouldSoft = @("claude", "node", "npm", "jq", "markdownlint-cli2", "codespell", "lychee", "psscriptanalyzer")
$shouldHard = @("gh")
$shouldFull = @("claude", "node", "npm", "jq", "gh", "docker", "markdownlint-cli2", "codespell", "lychee", "psscriptanalyzer", "bun", "pueue")
$shouldDurable = @("nats-server", "nats-cli")

switch ($Profile) {
  "soft" { $must = $mustSoft; $should = $shouldSoft }
  "hard" { $must = $mustHard; $should = $shouldHard }
  "full" { $must = $mustFull; $should = $shouldFull }
  "durable" { $must = $mustDurable; $should = $shouldDurable }
}

$ids = @()
foreach ($x in ($must + $should)) {
  if ($ids -notcontains $x) { $ids += $x }
}

$tools = @()
foreach ($id in $ids) {
  $tools += (Check-One $id)
}

$skillIds = @("foreman", "scrapling", "graphify", "superpowers")
$skills = @()
foreach ($id in $skillIds) {
  $skillPath = Join-Path $env:USERPROFILE ".claude\skills\$id"
  $repoSkillPath = Get-NormalizedPath (Join-Path $Root "skills\$id")
  $skillItem = Get-Item -LiteralPath $skillPath -Force -ErrorAction SilentlyContinue
  if (-not $skillItem) {
    $status = "missing"
    $detail = "not linked at $skillPath"
  } elseif ($null -ne $skillItem.LinkType) {
    $actualTarget = @($skillItem.Target)[0]
    $actualTarget = Get-NormalizedPath $actualTarget (Split-Path -Parent $skillPath)
    $commonRepoSkillPath = if ($CommonSkillsRoot) { Join-Path $CommonSkillsRoot $id } else { $null }
    if ($actualTarget -eq $repoSkillPath -or $actualTarget -eq $commonRepoSkillPath) {
      $status = "ok"
      $detail = "linked at $skillPath"
    } else {
      $status = "warn"
      $detail = "present but not linked to repo"
    }
  } else {
    $status = "warn"
    $detail = "present but not linked to repo"
  }
  $skills += [pscustomobject]@{ id = $id; status = $status; detail = $detail }
}

$lockAtomic = Get-LockAtomicityProbe
$lockAtomicityRows = @($lockAtomic.rows)

$mustFail = @()
foreach ($m in $must) {
  $t = $tools | Where-Object { $_.id -eq $m } | Select-Object -First 1
  if (-not $t -or $t.status -ne "ok") {
    $st = if ($t) { $t.status } else { "missing" }
    # F5: on Git-Bash durable, flock absence is not a hard fail when mkdir pin is trusted
    if ($m -eq "flock" -and $Profile -eq "durable" -and $lockAtomic.trustedAtomic) {
      continue
    }
    $mustFail += "${m}:${st}"
  }
}
$ready = ($mustFail.Count -eq 0)

if ($Profile -eq "durable" -and -not $lockAtomic.trustedAtomic) {
  $mustFail += "lock_atomicity:no_trusted_atomic_mechanism"
  $ready = $false
}

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
    skills     = $skills
    lock_atomicity = $lockAtomicityRows
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
  $docsGroup = @($tools | Where-Object { $_.id -in @("markdownlint-cli2", "codespell", "lychee", "psscriptanalyzer") } | ForEach-Object { "$($_.id):$($_.status)" })
  if ($docsGroup.Count) { [void]$lines.Add("DOCS_GROUP: $($docsGroup -join ' ')") }
  [void]$lines.Add("---")
  [void]$lines.Add("LOCK_ATOMICITY")
  [void]$lines.Add(("{0,-8} {1,-10} {2,-16} {3,-12} {4}" -f "MECH", "VERDICT", "EVIDENCE", "FS_CLASSES", "PATH"))
  foreach ($row in $lockAtomicityRows) {
    $fsc = ($row.filesystem_classes -join ",")
    [void]$lines.Add(("{0,-8} {1,-10} {2,-16} {3,-12} {4}" -f $row.mechanism, $row.verdict, $row.evidence_class, $fsc, $row.path))
    if ($row.sha256) { [void]$lines.Add("  sha256=$($row.sha256)") }
    if ($row.version) { [void]$lines.Add("  version=$($row.version)") }
    if ($row.notes) { [void]$lines.Add("  notes=$($row.notes)") }
  }
  [void]$lines.Add("---")
  [void]$lines.Add("SKILLS")
  [void]$lines.Add(("{0,-16} {1,-10} {2}" -f "SKILL", "STATUS", "DETAIL"))
  foreach ($skill in $skills) {
    [void]$lines.Add(("{0,-16} {1,-10} {2}" -f $skill.id, $skill.status, $skill.detail))
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
