make_fixture_repo() {
  local dir="$1"
  git init -q -b main "$dir"
  git -C "$dir" config user.name test
  git -C "$dir" config user.email test@test
  mkdir -p "$dir/src" "$dir/tests" "$dir/.foreman"
  echo "# fixture" > "$dir/README.md"
  printf '#!/usr/bin/env bash\necho ok\n' > "$dir/src/app.sh"
  printf '#!/usr/bin/env bash\nbash src/app.sh | grep -q ok\n' > "$dir/tests/test_sample.sh"
  cat > "$dir/.foreman/config.toml" <<'EOF'
[worker]
vendor = "grok"
[checks]
command = "bash tests/test_sample.sh"
[limits]
max_rework_rounds = 3
round_timeout_min = 30
[gate]
forbidden_paths = ["tests/**", ".github/**", ".foreman/**", "*.lock", "package-lock.json"]
hash_paths = ["tests/**", ".github/**"]
EOF
  git -C "$dir" add -A
  git -C "$dir" -c core.hooksPath= commit -qm "fixture: initial"
}
