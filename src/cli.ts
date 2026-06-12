#!/usr/bin/env node
import { readFileSync, writeFileSync } from "fs";
import { convertToYamlWithRefs, ConvertOptions } from "./index";

const HELP = `Usage: json-to-yaml-ref [input.json] [-o output.yaml]

Convert JSON to YAML with anchors/aliases for duplicate structures.

Args:
  input.json        Path to JSON file. If omitted, reads from stdin.

Options:
  -o, --output      Write YAML to this file. If omitted, prints to stdout.
  --match <mode>    Equality mode: canonical (default) or exact.
  --min-size <n>    Min node count for a structure to be ref'd (default 1).
  --include-scalars Also dedup repeated scalar values (default off).
  --max-alias-count <n>
                    Cap the alias score so the output always parses safely
                    (default 100, matching yaml's maxAliasCount). The lib
                    drops the heaviest refs to stay under it. Pass -1 to
                    disable the guard (alias unboundedly).
  -h, --help        Show this help.

Examples:
  json-to-yaml-ref demo/input.json
  json-to-yaml-ref demo/input.json -o out.yaml
  json-to-yaml-ref demo/input.json --match exact --min-size 4
  cat demo/input.json | json-to-yaml-ref`;

function main(): void {
	const args = process.argv.slice(2);
	let inPath: string | undefined;
	let outPath: string | undefined;
	const options: ConvertOptions = {};

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-h" || a === "--help") {
			console.log(HELP);
			return;
		} else if (a === "-o" || a === "--output") {
			outPath = args[++i];
		} else if (a === "--match") {
			const m = args[++i];
			if (m !== "canonical" && m !== "exact") {
				console.error(`--match must be canonical or exact`);
				process.exit(1);
			}
			options.matchMode = m;
		} else if (a === "--min-size") {
			options.minSize = Number(args[++i]);
		} else if (a === "--max-alias-count") {
			options.maxAliasCount = Number(args[++i]);
		} else if (a === "--include-scalars") {
			options.includeScalars = true;
		} else if (!a.startsWith("-")) {
			inPath = a;
		} else {
			console.error(`Unknown option: ${a}`);
			process.exit(1);
		}
	}

	const raw = inPath ? readFileSync(inPath, "utf8") : readFileSync(0, "utf8");
	const yaml = convertToYamlWithRefs(JSON.parse(raw), options);

	if (outPath) {
		writeFileSync(outPath, yaml);
		console.error(`Wrote ${outPath}`);
	} else {
		process.stdout.write(yaml);
	}
}

main();
