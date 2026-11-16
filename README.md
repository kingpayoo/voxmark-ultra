# VoxMark Ultra

A fast CommonMark 0.31.2 + GFM 0.29 Markdown parser in plain JavaScript
(no dependencies), written for the make.fun bounty
"Make Markdown rendering faster" (markdown-render-speed-02).

## Status (honest)

**663 / 720 cases pass** (median of 3 local runs, 2026-11-16 ~00:30 WIB):

- Spec examples: **652 / 680**
- Generated README docs: **11 / 40**

This entry is **not yet submittable as a passing entry**: a failing entry
ranks below every passing entry, so 720/720 is required. The remaining
57 failures are listed below.

## Speed (local, median of 3)

- Run 1: 843.9 ms
- Run 2: 566.4 ms
- Run 3: 455.0 ms
- **Median: 566.4 ms** (566,438 us)

The sandbox is roughly 5x slower than this VM, so the implied sandbox
time is about 2,830,000 us — above the current top-5 cutoff of
1,360,000 us and above the #1 time of 980,000 us. Speed work was not
the binding constraint; correctness was.

## Usage

```js
import { parse } from "./parse.js";
const html = parse("# hello\n\nsome *text*");
```

`parse(markdown)` returns the rendered HTML string. It keeps no state
between calls: no caching across inputs, no input recognition.

## Design

- Index-based block scanning over a line array; no per-line regex where
  a scan suffices.
- Inline parsing tokenises into a flat item list, resolves emphasis
  with marked's m-counter (outside-in, recursive), then renders.
- String building by array join; reused buffers where cheap; no
  try/catch in hot paths; Set lookups for block tags.
- Faithful to marked 18.1.3 behaviours verified by probe, including:
  the `ge()` HTML-block trailing-newline rule, blockquote lazy
  continuation kept-space rule, tilde fences never stripping indent,
  link-reference definitions (multi-line labels, title spanning lines,
  first definition wins), and GFM autolinks with trailing-punctuation
  trimming.

## Remaining failures (57)

Spec (28): cm-241, cm-416, cm-417, cm-442, cm-444, cm-445, cm-454,
cm-456, cm-457, cm-470, cm-524, cm-526, cm-536, cm-538, cm-545,
cm-547, cm-548, cm-549, cm-568, cm-590, cm-619, cm-622, cm-624, cm-632.
GFM (4): gfm-627, gfm-633, gfm-634, gfm-635.
Docs (29): doc-02, doc-04, doc-05, doc-07, doc-08, doc-09, doc-12,
doc-13, doc-14, doc-15, doc-16, doc-17, doc-18, doc-19, doc-20, doc-22,
doc-23, doc-24, doc-25, doc-26, doc-28, doc-30, doc-31, doc-33, doc-34,
doc-35, doc-36, doc-37, doc-38.

Largest groups: emphasis m-counter edge cases (nested `***` runs,
leftover opener chars, e.g. `**foo*` should give `*<em>foo</em>`),
scheme autolinks (`mailto:` / `xmpp:` as a single link), link text
containing `<`, and generated-doc issues (all-empty table rows from a
lone tab line, fenced-code tab handling, table rows without pipes).

## Repo

- `parse.js` — the parser (entry point, exports `parse`).
- `main.ts` — thin CLI wrapper used by the grader harness.
- `package.json` — package metadata (no dependencies).
- `LICENSE` — MIT.

Built fresh in a single recorded session (third rewrite); the earlier
705/720 code on disk had no valid recording and was not reused.
