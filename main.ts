// VoxMark Ultra entrypoint. Runs as `node /bot/main.ts` on Node 22.
// Reads the case list from the input directory, renders every case alone
// with parse() from parse.js, and writes the HTML strings (in the cases'
// order) to html.json in the output directory. The two environment
// variables let the same driver run outside a container for local checks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./parse.js";

const srcDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const dstDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

const input = JSON.parse(readFileSync(join(srcDir, "cases.json"), "utf8"));
const rendered = new Array(input.length);
for (let idx = 0; idx < input.length; idx++) {
  rendered[idx] = parse(input[idx].markdown);
}
mkdirSync(dstDir, { recursive: true });
writeFileSync(join(dstDir, "html.json"), JSON.stringify(rendered));
