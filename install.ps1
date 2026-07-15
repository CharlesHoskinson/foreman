# Foreman install (Windows) — junctions for Claude + portable Agent Skills home
# Run from elevated or normal shell; junctions do not require admin for user dirs.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = Get-Location }

function Ensure-Junction($Link, $Target) {
  if (Test-Path $Link) {
    Write-Host "[foreman] already exists: $Link"
    return
  }
  $parent = Split-Path -Parent $Link
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  cmd /c mklink /J "$Link" "$Target" | Out-Null
  Write-Host "[foreman] linked $Link -> $Target"
}

$SkillSrc = Join-Path $Root "skills\foreman"
if (-not (Test-Path (Join-Path $SkillSrc "SKILL.md"))) {
  throw "SKILL.md not found at $SkillSrc"
}

Ensure-Junction "$env:USERPROFILE\.claude\skills\foreman" $SkillSrc
Ensure-Junction "$env:USERPROFILE\.agents\skills\foreman" $SkillSrc
Ensure-Junction "$env:USERPROFILE\.grok\skills\foreman" $SkillSrc

$AgentsDst = "$env:USERPROFILE\.claude\agents"
New-Item -ItemType Directory -Force -Path $AgentsDst | Out-Null
Copy-Item (Join-Path $Root "agents\*.md") $AgentsDst -Force
Write-Host "[foreman] agents copied to $AgentsDst"

New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.foreman\runs" | Out-Null
Write-Host "[foreman] install complete. Soft mode ready."
Write-Host "[foreman] Boot: cd $Root ; claude   then  /model fable  and  /foreman"
