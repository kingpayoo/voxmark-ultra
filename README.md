# voxmark-ultra

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/kingpayoo/voxmark-ultra/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/kingpayoo/voxmark-ultra/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

VoxMark Ultra is a fast CommonMark 0.31.2 + GFM 0.29 Markdown parser in plain JavaScript (no dependencies), written for the make.fun bounty "Make Markdown rendering faster" (markdown-render-speed-02). It renders Markdown to exactly the same HTML as marked 18.1.3.

## Status

**720 / 720 cases pass** (median of 3 local runs, 2026-11-17 ~00:37 WIB):

- Spec examples: **680 / 680**
- Generated README docs: **40 / 40**

## Speed (local, median of 3)

- Run 1: 911.0 ms
- Run 2: 700.9 ms
- Run 3: 602.5 ms
- **Median: 700.9 ms** (700,930 us)

The sandbox is roughly 5x slower than this VM, so the implied sandbox time is about 3,500,000 us — above the current top-5 cutoff of 1,360,000 us and above the #1 time of 980,000 us. Correctness came first; speed work was not done.

## Run it

```sh
MAKEFUN_INPUT_DIR=<input-dir> MAKEFUN_OUTPUT_DIR=<output-dir> node main.ts
```

`main.ts` reads `cases.json` from the input directory, renders every case alone with `parse()` from `parse.js`, and writes the HTML strings (in the cases' order) to `html.json` in the output directory.

## Usage

```js
import { parse } from "./parse.js";
const html = parse("# hello\n\nsome *text*");
```

`parse(markdown)` returns the rendered HTML string. It keeps no state between calls: no caching across inputs, no input recognition.

## Design

- Index-based block scanning over a line array; no per-line regex where a scan suffices.
- Inline parsing tokenises into a flat item list, resolves emphasis with marked's m-counter (outside-in, recursive) plus its whole-source `ze` masking, then renders.
- String building by array join; reused buffers where cheap; no try/catch in hot paths; Set lookups for block tags.
- Faithful to marked 18.1.3 behaviours verified by probe, including: the `ge()` HTML-block trailing-newline rule, blockquote lazy continuation kept-space rule, tilde fences never stripping indent, link-reference definitions (multi-line labels, title spanning lines, first definition wins), GFM autolinks with trailing-punctuation trimming, and the `emStrong` whole-source mask that suppresses emphasis near code spans with an inner backtick.

## Repo

- `parse.js` — the parser (entry point, exports `parse`).
- `main.ts` — thin CLI wrapper used by the grader harness.
- `package.json` — package metadata (no dependencies).
- `LICENSE` — MIT.

---

<sub>Entered on [make.fun](https://make.fun/?ref=qh6z81g8&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
