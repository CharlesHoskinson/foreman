# Pel reading with PixelRAG

Read on 2026-09-13 with PixelRAG 0.4.0. This was the latest published version in both the package registry and the official release listing. The installed package was already 0.4.0. The update refreshed its dependencies and added the declared PDF extra. The downloaded wheel matches the registry SHA-256 digest.

PixelRAG's `pixelshot` command rendered all 29 pages at 200 DPI and JPEG quality 95. The assistant read all 29 page images. This used the rendering stage and visual reading. It did not build an embedding index or query the public Wikipedia service.

The [installation and reading receipt](../pixelrag/installation-and-reading.json) records versions, the exact command, source PDF hash, image hashes, and page coverage. The [page directory](pixelrag/arxiv-2505.13453v2.png.tiles/) preserves the images. `tile_0000.jpg` is page 1 and `tile_0028.jpg` is page 29.

## Findings applied to the release

| Pages | Finding | OpenSpec response |
| --- | --- | --- |
| 10–11, 14 | Exact glyphs differ from extracted text. | M1 uses the documented `\|>` ASCII normalization, corrected keyword characters, and a separate caret placeholder. See [glyph verification](glyph-verification.md). |
| 12, 15–16 | One-based list semantics conflict with some positional examples and loop indices. | M1 selects one-based behavior and records example corrections. |
| 13–14, 18 | Fixed-arity closures coexist with sequencing examples that look variadic. | M1 defines exact builtin argument specifications and classifies sequence syntax corrections. |
| 18 | `for` returns one result per input. `do/async` returns the last source expression after all complete. | M4 preserves these semantics. M5 uses bounded self-recursion for stateful repair. |
| 19–22 | Restart options preserve useful results while code is corrected. | M2 defines draft correction. M4 defines durable result reuse and explicit revision mapping. |
| 21 | The displayed print signature and prose disagree about the newline default. | M1 records an explicit compatibility choice. |
| 22 | Automatic concurrency uses symbol dependencies. | M4 also checks resources and external effects. Symbol independence alone does not prove that concurrent writes are safe. |
| 23–25 | Hierarchical agents and meetings are application examples. | Foreman uses its bounded host library and retains existing Council behavior outside the initial migration subset. |

The figures illustrate the paper's design claims. They are not performance measurements or proofs of runtime security. The release keeps host capability checks and tests its own claims.

## Tool sources

- [PixelRAG 0.4.0 release](https://github.com/StarTrail-org/PixelRAG/releases/tag/v0.4.0).
- [Package registry](https://pypi.org/project/pixelrag/0.4.0/).
- [Captured official README](../pixelrag/README.md).
