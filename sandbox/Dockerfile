# syntax=docker/dockerfile:1
# sandbox/Dockerfile — hard-mode CONTAINER profile (hard-mode-launcher Task 4).
#
# Minimal base + exactly what the sandboxed worker and its root-init firewall
# need:
#   - git           — the worker never commits (worker-run.sh's prompt
#                      preamble forbids it; the host commits host-side), but
#                      the vendor CLIs still shell out to `git status`/`git
#                      diff`/etc. for ordinary repo awareness.
#   - iptables/ipset — init-firewall.sh's default-deny egress allowlist.
#   - ca-certificates — TLS to the one allowed vendor API host.
#   - gosu          — root -> unprivileged `worker` drop in entrypoint.sh
#                      (github.com/tianon/gosu; a `su`/`sudo` replacement
#                      built for exactly this container PID-1 use case).
#   - nodejs/npm    — installs the two live vendor CLIs (grok, codex) so
#                      hard_mode.vendor can select either at runtime without
#                      rebuilding the image.
#
# No secrets baked in: auth (device-code / API key) is supplied at container
# RUN time via `--env-file` (worker-run.sh), never here, never in a layer.
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         git iptables ipset ca-certificates gosu nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# npm i -g @xai-official/grok / @openai/codex@latest — the same verified
# install paths already used elsewhere in this repo (env/bootstrap-wsl.sh,
# skills/foreman/references/reference-environment.md).
RUN npm install -g @xai-official/grok@latest @openai/codex@latest \
    && npm cache clean --force

# Unprivileged user the entrypoint drops into after applying the firewall as
# root. Matches worker-run.sh's `--tmpfs /home/worker` mount (a writable
# $HOME under the otherwise `--read-only` rootfs, for the vendor CLI's own
# cache/token-refresh needs).
RUN useradd --create-home --uid 1000 --shell /bin/bash worker

COPY init-firewall.sh entrypoint.sh /
RUN chmod 0755 /init-firewall.sh /entrypoint.sh

# No USER directive: the image starts as root so entrypoint.sh can apply the
# firewall (needs CAP_NET_ADMIN) before it deliberately drops to `worker`.
ENTRYPOINT ["/entrypoint.sh"]
