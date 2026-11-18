// Builds data/words.json from jyutping-chart's sample words, keeping only
// two-syllable words that have a real-speaker recording.
//
//   npm run build:words [-- path/to/jyutping-chart]

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { buildWordList } from "../public/src/words.js";

const root = path.resolve(import.meta.dirname, "..");
const chartDir = path.resolve(root, process.argv[2] ?? "jyutping-chart");
const audioDir = path.join(chartDir, "audio", "chinese");
const source = fs.readFileSync(path.join(chartDir, "javascript", "SampleWordsValue.js"), "utf8");

// The data file is an Angular module; stub `angular` and pull out the object.
const sandbox = { angular: { module: () => ({ value: () => {} }) } };
vm.runInNewContext(`${source}\n;__out = sampleWordsFunc();`, sandbox);

const words = buildWordList(sandbox.__out, (w) => fs.existsSync(path.join(audioDir, `${w}.mp3`)));

const outFile = path.join(root, "public", "data", "words.json");
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, "[\n" + words.map((w) => JSON.stringify(w)).join(",\n") + "\n]\n");
console.log(`Wrote ${words.length} words to ${path.relative(root, outFile)}`);

// Copy just the recordings the app uses into public/audio/ (gitignored) so the
// site is self-contained and deployable.
const audioOut = path.join(root, "public", "audio");
fs.rmSync(audioOut, { recursive: true, force: true });
fs.mkdirSync(audioOut, { recursive: true });
for (const w of words) fs.copyFileSync(path.join(audioDir, `${w.word}.mp3`), path.join(audioOut, `${w.word}.mp3`));
console.log(`Copied ${words.length} recordings to ${path.relative(root, audioOut)}/`);
