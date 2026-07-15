# Foreman documentation site

Dogfood target for the Foreman skill.

**Status:** scaffold only — build with soft-mode Foreman (Claude architect +
Grok implementer), or fill in `index.html` here.

## Intended content

1. What Foreman is (soft + hard)
2. Roles and lanes
3. Five-part spec
4. Task loops (diagrams)
5. Security model (honest limits)
6. Install and Claude boot
7. Lineage (Fable Advisor + original Foreman)

## Local preview (after build)

```bash
# from repo root
python -m http.server 8080 --directory site
```
