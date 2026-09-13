# Pel PDF glyph verification

Inspected: 2026-09-13. Source: the pinned [Pel v2 PDF](https://arxiv.org/pdf/2505.13453v2), printed pages 11 and 14.

The text extraction contains glyph substitutions. It is a search aid, not the authority for exact lexical characters.

| Location | Visual observation | Release decision |
| --- | --- | --- |
| Page 11, PIPE terminal | A hollow right-pointing triangle prints inside the string literal. | Normalize the pipe to ASCII `\|>`. This is an explicit compatibility decision. |
| Page 11, KEY regex | The class contains letters, digits, underscore, escaped minus, plus, star, slash, backslash, question mark, exclamation mark, less-than, greater-than, equals, and period. It does not contain caret. | Include `*` and `<`. Remove the extraction-induced caret from the keyword class. |
| Page 11, SYMBOL regex | The exclusions include vertical bar and greater-than, together with whitespace and the other printed delimiters. | Give `\|>` lexical priority. Define caret placeholder handling separately. |
| Page 14, piping heading and examples | The pipe is a triangle. The placeholder is a distinct caret. Multiplication uses star. | Keep `^` as the placeholder and `*` as multiplication. |

The vertical-bar and greater-than exclusions, together with the paper's Elixir reference, support the `|>` ASCII normalization. This is an inference from the rendered source. The PDF rendering does not establish the author's original source bytes. Do not describe extracted `^>` as verified paper syntax.

The PDF embeds JetBrains Mono for code. The inspection used rendered page images rather than copied text. Original captures remain unchanged.

- [Page 11](glyph-page-11.png): terminal definitions and character classes.
- [Page 14](glyph-page-14.png): pipe and caret examples.
- [Manifest](glyph-manifest.json): source PDF and rendered-image hashes.

M1 records the final lexical rules, classifications, and positive and negative fixtures. Earlier advisory graph snapshots retain the earlier interpretation as historical evidence.

The later [PixelRAG reading](pixelrag-reading.md) independently re-rendered and checked all 29 pages with the latest published PixelRAG release. Pages 11 and 14 confirmed the glyph observations above.
