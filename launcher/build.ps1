#!/usr/bin/env pwsh
# build.ps1 — compile foreman-launch for Windows x64.
#
# T1 spec REV2 resolution 4 (binding):
#   - NO --windows-icon: no icon asset exists in this repo, and passing the
#     flag without one fails the build (Bun #19916 territory).
#   - --no-compile-autoload-dotenv --no-compile-autoload-bunfig for
#     deterministic builds (no ambient .env / bunfig.toml autoload baked in).
#   - NEVER --bytecode when cross-compiling / compiling generally (Bun
#     #18416 hazard).
# Local build is UNSIGNED (CI signing is out of scope for this task) — see
# skills/foreman/references/launcher.md for the Defender/SmartScreen note.
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot
try {
    Write-Host "== bun --version =="
    bun --version
    if ($LASTEXITCODE -ne 0) { throw "bun --version failed" }

    Write-Host "== bun install --frozen-lockfile =="
    bun install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "bun install failed" }

    New-Item -ItemType Directory -Force -Path dist | Out-Null

    Write-Host "== bun build --compile (windows-x64) =="
    bun build --compile --minify --target=bun-windows-x64 `
        --no-compile-autoload-dotenv --no-compile-autoload-bunfig `
        --outfile dist/foreman-launch.exe `
        src/launch.ts
    if ($LASTEXITCODE -ne 0) { throw "bun build --compile failed with exit code $LASTEXITCODE" }

    $hash = Get-FileHash -Algorithm SHA256 -Path dist/foreman-launch.exe
    Write-Host "SHA256($($hash.Path)) = $($hash.Hash)"

    # Post-build signing would go here (signtool.exe), gated behind a
    # $env:FOREMAN_SIGN_CERT check — out of scope for this local, unsigned
    # build (CI signing tracked separately).
}
finally {
    Pop-Location
}
