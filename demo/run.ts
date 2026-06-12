import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { convertToYamlWithRefs } from "../src/index";

const inputPath = join(__dirname, "input.json");
const outputPath = join(__dirname, "output.yaml");

const raw = readFileSync(inputPath, "utf8");
const json = JSON.parse(raw);
const yaml = convertToYamlWithRefs(json);

writeFileSync(outputPath, yaml);

// --- round-trip verification: aliases must resolve back to the same data ---
function canonical(obj: any): any {
    if (Array.isArray(obj)) return obj.map(canonical);
    if (obj && typeof obj === "object") {
        const out: Record<string, any> = {};
        for (const k of Object.keys(obj).sort()) out[k] = canonical(obj[k]);
        return out;
    }
    return obj;
}

// The output must parse with stock settings — the alias budget guarantees we
// never trip the parser's billion-laughs guard (default maxAliasCount: 100).
let safe = true;
let roundTripped: any;
try {
    roundTripped = parse(yaml);
} catch (e) {
    safe = false;
    console.error(`default parse THREW: ${(e as Error).message}`);
    roundTripped = parse(yaml, { maxAliasCount: -1 });
}

const ok =
    JSON.stringify(canonical(roundTripped)) === JSON.stringify(canonical(json));

const anchors = (yaml.match(/&[A-Za-z0-9_-]+/g) || []).length;
const aliases = (yaml.match(/\*[A-Za-z0-9_-]+/g) || []).length;

console.log(`Wrote ${outputPath}`);
console.log(
    `bytes ${raw.length} -> ${yaml.length} ` +
        `(${Math.round((1 - yaml.length / raw.length) * 100)}% smaller)`
);
console.log(`anchors ${anchors}, aliases ${aliases}`);
console.log(`default-parse ${safe ? "OK" : "THREW"}`);
console.log(`round-trip ${ok ? "OK" : "MISMATCH"}`);

if (!ok || !safe) process.exit(1);
