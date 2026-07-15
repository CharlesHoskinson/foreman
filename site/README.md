# Foreman documentation site

Static dogfood site explaining the combined Foreman skill (soft + hard).

## Preview

```powershell
cd C:\Users\charl\foreman
python -m http.server 8080 --directory site
# open http://localhost:8080/
```

Or open `site/index.html` directly in a browser.

## Files

| File | Role |
|---|---|
| `index.html` | Single-page docs (roles, lanes incl. codex-auditor, loops, security, install) |
| `style.css` | Industrial field-manual theme |

Scroll-spy is a small inline script in `index.html` — no external JS.

## Content notes

Site should stay aligned with `skills/foreman/SKILL.md`:

- Default soft pipeline: Grok implements → architect verifies → **Codex Sol audits**
- Four roles: orchestrator, worker, auditor, advisor
