# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-function TypeScript library: converts a JS/JSON object to a YAML string, aggressively deduplicating repeated nested objects/arrays into YAML anchors (`&name`) and aliases (`*name`). Built on the `yaml` package's `Document` AST. Public API: `convertToYamlWithRefs(jsonObject, options?)` in `src/index.ts` (plus the `ConvertOptions` type). CLI is `src/cli.ts`; demo+verify is `demo/run.ts` (`npm run demo`).

## Commands

- Build: `npx tsc` / `npm run build` — compiles `src/` → `dist/` (CommonJS, es6, emits `.d.ts`).
- Demo: `npm run demo` — converts `demo/input.json` → `demo/output.yaml`, prints anchor/alias counts + size reduction, and asserts a lossless round-trip (exits non-zero on mismatch). This is the de-facto test.
- Tests: no unit-test runner; `npm test` is a placeholder that errors.

## Architecture

The core is `src/index.ts`. Flow:

1. Wrap the input in a `yaml` `Document` (builds the full YAML AST up front).
2. `walk(obj, path)` does a top-down (pre-order) traversal, tracking `path` (string keys / stringified array indices).
3. Dedup key is the structure's serialization held in `seen: Map<serialized, {node, path}>`. **Lazy anchoring**: first sighting just records the node + recurses. On a *repeat* sighting, it retroactively sets `firstNode.anchor` and replaces the current position with `doc.createAlias(firstNode)` via `doc.setIn` — and does NOT recurse into the duplicate. So anchors only ever exist when there's a real alias (no anchor noise), and always point at the first occurrence in traversal order.
4. `doc.toString()` renders anchors/aliases automatically.

`ConvertOptions` (all optional; defaults = max aggressiveness):
- `matchMode`: `"canonical"` (default — sorts object keys before serializing, so key-order differences still match; aliased copies adopt the first occurrence's key order, lossless for mappings) or `"exact"` (byte-faithful, fewer matches).
- `minSize`: min node count (subtree incl. self) for a structure to be eligible. Default 1 = ref everything.
- `includeScalars`: also dedup repeated scalar values. Default false (structures only).

Key implementation constraints to preserve when editing:
- Anchor names are independent of the path's validity: `anchorBase` picks the nearest non-numeric path key, `sanitize` strips invalid chars, `uniqueName` adds a `_2`/`_3` collision suffix. (The old path-`join("_")` scheme silently disabled all dedup under keys containing `/`, `.`, spaces, etc.)
- Only `YAMLMap`/`YAMLSeq` get anchors unless `includeScalars` is set. `doc.getIn(path, true)` (keepScalar) is required so scalar nodes come back as `Scalar` instances.
- Recursion stops at a duplicate. Equal ancestor/descendant pairs are impossible for finite data, so aliases never create cycles.
- Non-JSON-serializable values (cycles, etc.) are skipped via the `serialize` try/catch returning `null`.
- Aggressive aliasing can exceed `yaml`'s default `maxAliasCount` (100) on *parse* — `demo/run.ts` passes `maxAliasCount: -1` when verifying.

## Gotcha

Package name in `package.json` is `json-to-yaml-ref`, but `readme.md` install/import examples use `json-to-yaml-with-refs`. They disagree — check intent before relying on either.
