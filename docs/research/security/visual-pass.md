# PixelRAG Visual Pass

Date: 2026-08-01

Tool: PixelRAG 0.4.0 `pixelshot`

## Source and command

Rendered source:

https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html

Command:

```text
pixelshot <C2PA-2.2-URL> --output screenshots/c2pa --backend cdp --workers 1 --tile-height 4096 --quality 90 --viewport-width 1100 --wait-network-idle
```

The successful render produced 82 tiles. The retained tile manifest is:

`screenshots/c2pa/spec.c2pa.org_specifications_specifications_2.2_specs_C2PA_Specification.html.png.tiles/tiles.json`

## Inspected tiles and contribution

- `tile_0027.jpg`: The validation-results table and display requirements distinguish malformed, mismatch, revoked, unknown, and untrusted states. It also shows the requirement to warn when invalid manifest data is displayed and not attribute that data to the signer.
- `tile_0033.jpg`: The ingredient-validation flowchart confirms that validation applies through the provenance lineage, not only to the active manifest. The adjacent text states that normative text controls if the diagram and text differ.
- `tile_0038.jpg`: The security and harms section shows that threat modelling and harms assessment are ongoing processes, not one-time certification steps.
- `tile_0010.jpg`, `tile_0020.jpg`, and `tile_0060.jpg`: The binding, trust-list, and action-flow diagrams make separate stages visible: content binding, signer trust, and action history must not be collapsed into one `trusted` Boolean.

The visual pass therefore contributed three requirements that were not as clear from abstracts or short text excerpts:

1. Use typed provenance states and preserve the reason for failure; do not reduce validation to present/absent.
2. Recursively validate lineage and surface partial or flawed history.
3. Keep source integrity, signer trust, and factual assessment separate.

## Failed PDF capture retained as a diagnostic

The first `pixelshot` attempt targeted the AgentDojo PDF URL. The browser rendered the PDF viewer shell as a blank tile. The blank diagnostic is retained under `screenshots/agentdojo/`. It shows that reproducible visual collection must verify captured pixels, not treat a successful renderer exit code as evidence that a document was captured.
