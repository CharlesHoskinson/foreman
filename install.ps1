# Foreman install (Windows) — junctions for Claude + portable Agent Skills home
# Run from elevated or normal shell; junctions do not require admin for user dirs.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = Get-Location }
$SkippedDestinations = 0

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

function Ensure-Junction($Link, $Target) {
  $item = Get-Item -LiteralPath $Link -Force -ErrorAction SilentlyContinue
  if ($item) {
    if ($null -ne $item.LinkType) {
      $actualTarget = @($item.Target)[0]
      $actualTarget = Get-NormalizedPath $actualTarget (Split-Path -Parent $Link)
      $expectedTarget = Get-NormalizedPath $Target
      $commonTarget = if ($CommonSkillsRoot) { Join-Path $CommonSkillsRoot (Split-Path -Leaf $expectedTarget) } else { $null }
      if ($actualTarget -eq $expectedTarget -or $actualTarget -eq $commonTarget) {
        Write-Host "[foreman] ok (already linked): $Link -> $expectedTarget"
        return
      }
      Remove-Item -LiteralPath $Link -Force
    } else {
      Write-Warning "SKIP ${Link}: exists and is not a link — back it up or remove it, then re-run (it may contain *.local.md overlays; do not lose them)"
      $script:SkippedDestinations += 1
      return
    }
  }
  $parent = Split-Path -Parent $Link
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  cmd /c mklink /J "$Link" "$Target" | Out-Null
  Write-Host "[foreman] linked $Link -> $Target"
}

$SkillsRoot = Join-Path $Root "skills"
$ForemanSkillSrc = Join-Path $SkillsRoot "foreman"
if (-not (Test-Path (Join-Path $ForemanSkillSrc "SKILL.md"))) {
  throw "SKILL.md not found at $ForemanSkillSrc"
}

foreach ($skillDir in (Get-ChildItem -Directory $SkillsRoot)) {
  $name = $skillDir.Name
  $src = $skillDir.FullName
  Ensure-Junction "$env:USERPROFILE\.claude\skills\$name" $src
  Ensure-Junction "$env:USERPROFILE\.agents\skills\$name" $src
  Ensure-Junction "$env:USERPROFILE\.grok\skills\$name" $src
}

Write-Host "[foreman] $SkippedDestinations destinations skipped (unlinked real dirs)"

$AgentsDst = "$env:USERPROFILE\.claude\agents"
New-Item -ItemType Directory -Force -Path $AgentsDst | Out-Null
Copy-Item (Join-Path $Root "agents\*.md") $AgentsDst -Force
Write-Host "[foreman] agents copied to $AgentsDst"

New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.foreman\runs" | Out-Null
Write-Host "[foreman] install complete. Soft mode skill/agents linked."
Write-Host "[foreman] Next: env\tool-check.ps1 -Profile soft"
Write-Host "[foreman] Gaps:  env\bootstrap-windows.ps1 -Profile soft -Yes"
Write-Host "[foreman] Boot:  cd $Root ; claude   then  /model fable  and  /foreman"
