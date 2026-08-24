# Dedicated rootless engine host

These files define the only supported hard-mode engine for the v0.4.0
appliance. They do not modify the host automatically.

The operator must install the exact packages from `appliance-lock.json`, copy
the configuration files to `/etc/foreman-engine`, install the sysusers,
tmpfiles, and systemd definitions, and install the same subordinate-ID line in
both `/etc/subuid` and `/etc/subgid`. The line must not overlap another account.

Before the service starts, the operator must place the server certificate,
server key, and client CA at the paths named by the unit. The engine account
must own the files. Directories must use mode `0700`. The server key must use
mode `0600`. The control client key is a runtime secret and must not be stored
in this directory.

Run the TypeScript host qualifier before enabling the unit. Qualification must
confirm the exact package and Podman versions, account identity, subordinate-ID
ranges, directory ownership, mutual-TLS probe, protected-root probes, and the
absence of a fallback engine socket. A refusal leaves hard mode disabled. Soft
mode does not use this service.
