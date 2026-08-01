#!/usr/bin/env bats
load helpers

setup() {
  setup_tmp_repo
  cd "$REPO"
  mkdir -p scripts
}

@test "docs-check passes on a clean fixture" {
  cat > scripts/good.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture script that is fully documented.
set -euo pipefail
# @description Say hello.
# @stdout the greeting
hello() { echo hello; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 0 ]
  grep -q '"status": *"pass"' out.json
}

@test "docs-check fails on undocumented bash function" {
  cat > scripts/bad.sh <<'EOF'
#!/usr/bin/env bash
# @description Fixture with an undocumented function.
set -euo pipefail
mystery() { echo '?'; }
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
  grep -q 'undocumented function' <<< "$output"
}

@test "docs-check fails on script without purpose header" {
  printf '#!/usr/bin/env bash\nset -euo pipefail\n' > scripts/naked.sh
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
}

@test "docs-check writes machine-readable JSON" {
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ -f out.json ]
  grep -q '"schema": *"foreman.docs-check.v1"' out.json
}

@test "docs-check exits 2 when a required tool is force-missing" {
  DOCS_CHECK_FORCE_MISSING=lychee run bash "$SCRIPTS/docs-check.sh"
  [ "$status" -eq 2 ]
}

@test "docs-check fails on raw vendor invocation in agent definition" {
  mkdir -p agents
  cat > agents/bad-agent.md <<'EOF'
# Agent fixture

```bash
codex exec --sandbox workspace-write
```
EOF
  run bash "$SCRIPTS/docs-check.sh" --json out.json
  [ "$status" -eq 1 ]
  grep -q 'raw vendor invocation: agents/bad-agent.md:4:' <<< "$output"
  grep -A2 '"agent-invocations"' out.json | grep -q '"status": *"fail"'
}
