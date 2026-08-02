#!/usr/bin/env bats
# @description Fail-capable localization checks for the canonical Council skill,
#   its Codex interface, the Antigravity workspace plugin wrapper, installer
#   link targets, destination preservation, and tool-check skill inventory.
#   Uses fixtures and a disposable HOME only. No paid provider, network, or
#   inference is invoked. Python snippets use only the standard library.
bats_require_minimum_version 1.5.0

setup() {
  ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  CANONICAL="$ROOT/skills/council"
  PLUGIN="$ROOT/.agents/plugins/council"
  INSTALL="$ROOT/install.sh"
  TOOL_CHECK="$ROOT/env/tool-check.sh"
}

# @description Extract YAML frontmatter body from a SKILL.md path.
# @arg $1 path to SKILL.md
# @stdout frontmatter text between the opening and closing ---
frontmatter_body() {
  local path="$1"
  awk '
    BEGIN { in_fm = 0 }
    NR == 1 && $0 == "---" { in_fm = 1; next }
    in_fm && $0 == "---" { exit }
    in_fm { print }
  ' "$path"
}

# @description Extract one ## section body from the protocol file by exact title.
# @arg $1 section title without the leading "## "
# @stdout section body lines (heading itself omitted)
protocol_section() {
  local heading="$1"
  local protocol="$CANONICAL/references/protocol.md"
  awk -v h="$heading" '
    BEGIN { found = 0 }
    $0 == "## " h { found = 1; next }
    found && /^## / { exit }
    found { print }
  ' "$protocol"
}

# @description Collapse whitespace so exact phrases match across markdown wraps.
# @arg $1 multi-line section text
# @stdout single-line whitespace-normalized text
collapse_ws() {
  # tr+squeeze: newlines and runs of spaces become single spaces
  printf '%s' "$1" | tr '\n\t\r' '   ' | tr -s ' '
}

# @description Extract the tool-check SKILLS inventory row whose first field is
#   exactly "council". Other skill rows cannot satisfy the match.
# @arg $1 full tool-check stdout
# @stdout the council inventory row, or empty if absent
council_skill_row() {
  local block
  block="$(awk '/^SKILLS$/,/^---$/' <<<"$1")"
  awk '$1 == "council" { print; exit }' <<<"$block"
}

@test "canonical skill frontmatter is exact name+description only" {
  local skill_md="$CANONICAL/SKILL.md"
  [ -f "$skill_md" ]

  local body
  body="$(frontmatter_body "$skill_md")"
  [ -n "$body" ]

  # Exact required keys and values (no other frontmatter keys).
  [[ "$body" == *"name: council"* ]]
  [[ "$body" == *"description: Use when a decision benefits from independent cross-provider proposals, blinded non-author review, dissent preservation, or a typed abstention."* ]]

  # Closed-shape frontmatter parse via stdlib only (no PyYAML).
  run env -u PYTHONPATH python3 - "$skill_md" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
assert m, "frontmatter missing"
body = m.group(1)
fm = {}
for line in body.splitlines():
    if not line.strip():
        continue
    assert ":" in line, f"not a key:value line: {line!r}"
    key, _, val = line.partition(":")
    key = key.strip()
    val = val.strip()
    assert key, f"empty key in {line!r}"
    assert key not in fm, f"duplicate key: {key}"
    fm[key] = val
assert set(fm.keys()) == {"name", "description"}, f"unexpected keys: {sorted(fm)}"
assert fm["name"] == "council"
assert fm["description"] == (
    "Use when a decision benefits from independent cross-provider proposals, "
    "blinded non-author review, dissent preservation, or a typed abstention."
)
print("ok")
PY
  [ "$status" -eq 0 ]
  [[ "$output" == *"ok"* ]]
}

@test "protocol requires the advisory dissent loop and gate non-authority" {
  local protocol="$CANONICAL/references/protocol.md"
  [ -f "$protocol" ]

  # Exact phrases inside named protocol sections (not whole-file generic words).
  local required dissent authority non_approval
  required="$(collapse_ws "$(protocol_section "Required loop")")"
  dissent="$(collapse_ws "$(protocol_section "Dissent rule (binding)")")"
  authority="$(collapse_ws "$(protocol_section "Authority boundary")")"
  non_approval="$(collapse_ws "$(protocol_section "Non-approval classes")")"
  [ -n "$required" ]
  [ -n "$dissent" ]
  [ -n "$authority" ]
  [ -n "$non_approval" ]

  [[ "$required" == *"immutable review bundle"* ]]
  [[ "$required" == *"MODEL FAMILIES"* ]]
  [[ "$required" == *"gemini-3.6-flash-high"* ]]
  [[ "$required" == *"schema-valid, identity-bound, admissible"* ]]
  [[ "$required" == *"schema_invalid"* ]]
  [[ "$required" == *"quorum_not_met"* ]]
  [[ "$required" == *"insufficient_evidence"* ]]
  [[ "$required" == *"changes_requested"* ]]
  [[ "$required" == *"at least three admissible verdicts"* ]]
  [[ "$required" == *"at least two independent model-family failure domains"* ]]
  [[ "$required" == *"gate-eval.sh"* ]]
  [[ "$required" == *"merge-gate.sh"* ]]
  [[ "$required" == *"audit-verdict.json"* ]]
  [[ "$required" == *"Majority, deadline pressure"* ]]

  [[ "$dissent" == *"changes_requested"* ]]
  [[ "$dissent" == *"new immutable review bundle"* ]]

  [[ "$authority" == *"gate-eval.sh"* ]]
  [[ "$authority" == *"merge path only"* ]] || [[ "$authority" == *"`gate-eval.sh` / merge path only"* ]]

  [[ "$non_approval" == *"schema_invalid"* ]]
  [[ "$non_approval" == *"quorum_not_met"* ]]
  [[ "$non_approval" == *"insufficient_evidence"* ]]
  [[ "$non_approval" == *"stale response (bundle identity mismatch)"* ]]
}

@test "protocol binds responses to exact bundle identity base_sha head_sha diff hash" {
  local protocol="$CANONICAL/references/protocol.md"
  [ -f "$protocol" ]

  local section required
  section="$(collapse_ws "$(protocol_section "Bundle identity (binding)")")"
  required="$(collapse_ws "$(protocol_section "Required loop")")"
  [ -n "$section" ]
  [ -n "$required" ]

  # Exact immutable bundle identity fields inside the binding section.
  [[ "$section" == *'`base_sha`'* ]] || [[ "$section" == *"base_sha"* ]]
  [[ "$section" == *'`head_sha`'* ]] || [[ "$section" == *"head_sha"* ]]
  [[ "$section" == *"diff content hash"* ]]

  # Stale / inadmissible when identity differs (binding section).
  [[ "$section" == *"stale and inadmissible"* ]]

  # Ancestor check alone is not exact bundle identity (binding + loop).
  [[ "$section" == *"ancestor check alone is not exact bundle identity"* ]]
  [[ "$required" == *"base_sha"* ]]
  [[ "$required" == *"head_sha"* ]]
  [[ "$required" == *"diff content hash"* ]]
  [[ "$required" == *"ancestor check alone is not exact bundle identity"* ]]
}

@test "protocol and skill require sealed blinding before review" {
  local protocol="$CANONICAL/references/protocol.md"
  local skill_md="$CANONICAL/SKILL.md"
  [ -f "$protocol" ]
  [ -f "$skill_md" ]

  local section required stext
  section="$(collapse_ws "$(protocol_section "Blinding boundary (binding)")")"
  required="$(collapse_ws "$(protocol_section "Required loop")")"
  stext="$(collapse_ws "$(cat "$skill_md")")"
  [ -n "$section" ]
  [ -n "$required" ]

  # Exact identity classes and sealed mapping inside the blinding section.
  [[ "$section" == *"provider, model, CLI, worker, and author identity"* ]]
  [[ "$section" == *"random candidate identifiers"* ]]
  [[ "$section" == *"identity mapping sealed"* ]]
  [[ "$section" == *"Blinding is identity-only"* ]] || [[ "$section" == *"identity-only"* ]]

  # Required loop restates the blinding boundary before review.
  [[ "$required" == *"Blind candidates before review"* ]] || [[ "$required" == *"BEFORE a reviewer or judge sees candidates"* ]]
  [[ "$required" == *"random candidate identifiers"* ]]
  [[ "$required" == *"identity mapping sealed"* ]]

  # Skill summary states the blinding boundary (not frontmatter alone).
  [[ "$stext" == *"Blinding boundary"* ]] || [[ "$stext" == *"blinding boundary"* ]]
  [[ "$stext" == *"random candidate identifiers"* ]]
  [[ "$stext" == *"identity mapping sealed"* ]]
  [[ "$stext" == *"provider, model, CLI, worker, and author identity"* ]]
}

@test "ownership partitions Foreman, Council, and architect duties" {
  local ownership="$CANONICAL/references/ownership.md"
  [ -f "$ownership" ]
  local text
  text="$(cat "$ownership")"

  [[ "$text" == *"Foreman"* ]]
  [[ "$text" == *"Council"* ]]
  [[ "$text" == *"architect"* ]] || [[ "$text" == *"Architect"* ]]

  # Foreman ownership surface.
  [[ "$text" == *"provider dispatch"* ]] || [[ "$text" == *"dispatch"* ]]
  [[ "$text" == *"credential"* ]] || [[ "$text" == *"credentials"* ]]
  [[ "$text" == *"worktree"* ]]
  [[ "$text" == *"checkpoint"* ]]
  [[ "$text" == *"merge gate"* ]] || [[ "$text" == *"merge gates"* ]]

  # Council ownership surface.
  [[ "$text" == *"deliberation"* ]]
  [[ "$text" == *"quorum"* ]]
  [[ "$text" == *"dissent"* ]]
  [[ "$text" == *"abstention"* ]]
  [[ "$text" == *"advisory replay"* ]] || [[ "$text" == *"replay"* ]]

  # Architect owns fixes and next-round decision.
  [[ "$text" == *"fix"* ]] || [[ "$text" == *"finding"* ]]
  [[ "$text" == *"next round"* ]] || [[ "$text" == *"next-round"* ]] || [[ "$text" == *"run the next round"* ]]
}

@test "openai.yaml quotes the required Council interface strings" {
  local yaml_path="$CANONICAL/agents/openai.yaml"
  [ -f "$yaml_path" ]
  local text
  text="$(cat "$yaml_path")"

  [[ "$text" == *'display_name: "Council"'* ]]
  [[ "$text" == *'short_description: "Run cross-family advisory review loops"'* ]]
  [[ "$text" == *'default_prompt: "Use $council to review this implementation round and keep iterating until all actionable findings are fixed."'* ]]

  # Closed-shape interface YAML via stdlib only (no PyYAML).
  run env -u PYTHONPATH python3 - "$yaml_path" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
# Reject undeclared dependency path: this file is the exact interface object.
assert "interface:" in raw
iface = {}
current = None
for line in raw.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    if re.match(r"^interface:\s*$", line):
        current = "interface"
        continue
    m = re.match(r"^  ([A-Za-z0-9_]+):\s*\"(.*)\"\s*$", line)
    assert m, f"unexpected interface line: {line!r}"
    assert current == "interface", "keys outside interface"
    key, val = m.group(1), m.group(2)
    assert key not in iface, f"duplicate key: {key}"
    iface[key] = val
assert set(iface.keys()) == {
    "display_name",
    "short_description",
    "default_prompt",
}, f"unexpected keys: {sorted(iface)}"
assert iface["display_name"] == "Council"
assert iface["short_description"] == "Run cross-family advisory review loops"
assert iface["default_prompt"] == (
    "Use $council to review this implementation round and keep iterating "
    "until all actionable findings are fixed."
)
print("ok")
PY
  [ "$status" -eq 0 ]
  [[ "$output" == *"ok"* ]]
}

@test "antigravity plugin.json is the exact name-only object" {
  local manifest="$PLUGIN/plugin.json"
  [ -f "$manifest" ]
  run env -u PYTHONPATH python3 - "$manifest" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    raw = f.read()
doc = json.loads(raw)
assert doc == {"name": "council"}, f"unexpected manifest: {doc!r}"
# Reject trailing extra keys via exact object equality above.
print("ok")
PY
  [ "$status" -eq 0 ]
  [[ "$output" == *"ok"* ]]
}

@test "antigravity skill wrapper references canonical skill without copying protocol" {
  local wrapper="$PLUGIN/skills/council/SKILL.md"
  [ -f "$wrapper" ]
  local text
  text="$(cat "$wrapper")"

  # Must point at the canonical path, not re-host the policy.
  [[ "$text" == *"skills/council/SKILL.md"* ]]

  # Must not copy protocol or ownership policy body.
  [[ "$text" != *"immutable review bundle"* ]]
  [[ "$text" != *"gemini-3.6-flash-high"* ]]
  [[ "$text" != *"changes_requested"* ]]
  [[ "$text" != *"schema_invalid"* ]]
  [[ "$text" != *"quorum_not_met"* ]]
  [[ "$text" != *"insufficient_evidence"* ]]
  [[ "$text" != *"advisory replay"* ]]
  [[ "$text" != *"provider dispatch"* ]]
  [[ "$text" != *"base_sha"* ]]
  [[ "$text" != *"diff content hash"* ]]
}

@test "install links council into claude, agents, and grok skill roots" {
  [ -d "$CANONICAL" ]
  [ -f "$CANONICAL/SKILL.md" ]

  local home
  home="$(mktemp -d "${BATS_TEST_TMPDIR}/home.XXXXXX")"
  run env HOME="$home" bash "$INSTALL"
  [ "$status" -eq 0 ]

  [ -L "$home/.claude/skills/council" ]
  [ -L "$home/.agents/skills/council" ]
  [ -L "$home/.grok/skills/council" ]

  local expected
  expected="$(cd "$CANONICAL" && pwd -P)"
  local t
  for t in \
    "$home/.claude/skills/council" \
    "$home/.agents/skills/council" \
    "$home/.grok/skills/council"
  do
    local resolved
    resolved="$(cd "$t" && pwd -P)"
    [ "$resolved" = "$expected" ]
  done
}

@test "install preserves a real destination directory for council" {
  [ -d "$CANONICAL" ]

  local home
  home="$(mktemp -d "${BATS_TEST_TMPDIR}/home-preserve.XXXXXX")"
  mkdir -p "$home/.claude/skills/council"
  printf 'preserve-marker\n' > "$home/.claude/skills/council/marker.local.md"

  run env HOME="$home" bash "$INSTALL"
  [ "$status" -eq 0 ]

  # Real directory must remain a directory, not become a symlink.
  [ -d "$home/.claude/skills/council" ]
  [ ! -L "$home/.claude/skills/council" ]
  [ -f "$home/.claude/skills/council/marker.local.md" ]
  [ "$(cat "$home/.claude/skills/council/marker.local.md")" = "preserve-marker" ]
  [[ "$output" == *"SKIP"* ]] || [[ "$output" == *"skipped"* ]]
}

@test "tool-check skill inventory includes council from the checkout link" {
  [ -d "$CANONICAL" ]
  [ -f "$TOOL_CHECK" ]

  local home
  home="$(mktemp -d "${BATS_TEST_TMPDIR}/home-tc.XXXXXX")"
  mkdir -p "$home/.claude/skills"
  ln -s "$(cd "$CANONICAL" && pwd -P)" "$home/.claude/skills/council"

  # Linked: status must be ok and derived from the checkout link target.
  run env HOME="$home" bash "$TOOL_CHECK" --profile soft
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]  # readiness may fail on must-tools
  [[ "$output" == *"SKILLS"* ]]

  local row id st det
  row="$(council_skill_row "$output")"
  [ -n "$row" ]
  id="$(awk '{print $1}' <<<"$row")"
  st="$(awk '{print $2}' <<<"$row")"
  det="$(awk '{print substr($0, index($0,$3))}' <<<"$row")"
  [[ "$id" == "council" ]]
  [[ "$st" == "ok" ]]
  [[ "$det" == "linked at ~/.claude/skills/council" ]]
  # A status token from another skill row shall not satisfy the assertion:
  # status and detail are bound to the council row above.

  # Unlinked: status must report missing for council.
  rm -f "$home/.claude/skills/council"
  run env HOME="$home" bash "$TOOL_CHECK" --profile soft
  [ "$status" -eq 0 ] || [ "$status" -eq 1 ]
  row="$(council_skill_row "$output")"
  [ -n "$row" ]
  id="$(awk '{print $1}' <<<"$row")"
  st="$(awk '{print $2}' <<<"$row")"
  det="$(awk '{print substr($0, index($0,$3))}' <<<"$row")"
  [[ "$id" == "council" ]]
  [[ "$st" == "missing" ]]
  [[ "$det" == "not linked at ~/.claude/skills/council" ]]
}
