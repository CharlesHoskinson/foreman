## Delivery

- [x] 1. Record baseline and failing native-login regression tests.
- [x] 2. Implement bounded host credential retrieval and managed refresh.
- [x] 3. Integrate external-token login and account-bound refresh into the Codex transport.
- [x] 4. Enable this credential type in coding qualification without relaxing the native boundary.
- [x] 5. Run focused tests, strict type checks, and the broader verification suite.
- [x] 6. Verify the live Astra login through the compiled runtime.
- [x] 7. Obtain independent review and resolve findings.
- [x] 8. Package and install the verified candidate, preserving the previous build.

See `verification.md` for measured results and remaining upstream failures.
Review was independent source review, not cross-vendor Pel approval.
The deployment receipt is `/root/.local/share/foreman/native-chatgpt-installation-2026-09-15.json`.

## Integration review follow-up

- [x] Reproduce inference before the external-login completion notification.
- [x] Require successful completion before thread creation.
- [x] Reject missing completion at the original deadline.
- [x] Pass the five new regressions and the complete Codex transport test file.
- [ ] Obtain fresh review of the corrected integration candidate.
- [ ] Qualify and install the corrected runtime separately from the historical candidate above.
