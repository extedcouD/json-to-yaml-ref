# JSON to YAML with References

Convert JSON/JS objects to YAML, aggressively deduplicating repeated nested objects and arrays into YAML **anchors** (`&name`) and **aliases** (`*name`). Identical structures are emitted once and referenced everywhere else — smaller, DRY, still 100% valid YAML that round-trips back to the original data.

On a real-world OpenAPI spec this shrinks output by **~90%** (281 KB → 27.5 KB).

## Features

- **Aggressive deduplication:** every structure that appears more than once becomes an anchor + aliases — down to tiny shared shapes like `{ type: string }`.
- **No anchor noise:** anchors are only emitted when something actually references them (unique structures stay inline).
- **Order-insensitive matching:** by default, objects with the same keys/values in a different order are still treated as duplicates (lossless for mappings).
- **Readable anchor names:** derived from the nearest meaningful key (`&address`, `&settings`), with `_2`/`_3` suffixes on collisions.
- **Configurable sensitivity:** match mode, a minimum-size threshold, and optional scalar deduplication.
- **Lossless:** resolving the aliases reproduces the original data (verified by the demo's round-trip check).

## Installation

```bash
npm install json-to-yaml-ref
```

## Usage

```typescript
import { convertToYamlWithRefs } from "json-to-yaml-ref";

const jsonObject = {
	user: { name: "Alice", address: { street: "123 Main St", city: "Wonderland" } },
	admin: { name: "Bob", address: { street: "123 Main St", city: "Wonderland" } },
};

console.log(convertToYamlWithRefs(jsonObject));
```

**Output:**

```yaml
user:
  name: Alice
  address: &address
    street: 123 Main St
    city: Wonderland
admin:
  name: Bob
  address: *address
```

## API

### `convertToYamlWithRefs(jsonObject, options?): string`

Converts a JSON/JS object to a YAML string with anchors and aliases for duplicate structures.

| Parameter    | Type                       | Description                          |
| ------------ | -------------------------- | ------------------------------------ |
| `jsonObject` | `Record<string, any>`      | The object to convert.               |
| `options`    | `ConvertOptions` _(opt.)_  | Tuning knobs (see below).            |

#### `ConvertOptions`

All optional. Defaults are tuned for maximum deduplication.

| Option           | Type                        | Default       | Description                                                                                                                              |
| ---------------- | --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `matchMode`      | `"canonical"` \| `"exact"`  | `"canonical"` | `canonical` ignores object key order when matching (aliased copies adopt the first occurrence's order — lossless). `exact` is byte-faithful and matches less. |
| `minSize`        | `number`                    | `1`           | Minimum node count (collections + scalars in the subtree, self included) for a structure to be eligible. Raise it to skip tiny shapes.   |
| `includeScalars` | `boolean`                   | `false`       | Also dedup repeated scalar values. Off by default (scalar aliasing is usually noise).                                                    |

Returns the YAML `string`.

> **Note:** anchor names reflect the *first* occurrence, so two structurally-identical blocks with different key names share one anchor (e.g. a `form` that equals a `provider` becomes `*provider`). This is intentional and lossless.

## CLI

Installed as `json-to-yaml-ref`:

```bash
# file in, stdout out
json-to-yaml-ref input.json

# file in, file out
json-to-yaml-ref input.json -o output.yaml

# stdin
cat input.json | json-to-yaml-ref

# tune sensitivity
json-to-yaml-ref input.json --match exact --min-size 4 --include-scalars
```

| Flag                | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `-o, --output`      | Write YAML to a file (default: stdout).              |
| `--match <mode>`    | `canonical` (default) or `exact`.                    |
| `--min-size <n>`    | Min node count for a structure to be referenced.     |
| `--include-scalars` | Also dedup repeated scalar values.                   |
| `-h, --help`        | Show help.                                           |

## Examples

### Shared nested object

```typescript
const data = {
	project: { name: "Example", settings: { theme: "dark", layout: "grid" } },
	backup: { settings: { theme: "dark", layout: "grid" } },
};
console.log(convertToYamlWithRefs(data));
```

```yaml
project:
  name: Example
  settings: &settings
    theme: dark
    layout: grid
backup:
  settings: *settings
```

### Arrays

Array items are deduped too. The anchor name comes from the nearest non-numeric key (the index is skipped):

```typescript
const data = {
	list1: [{ id: 1, value: "A" }, { id: 2, value: "B" }],
	list2: [{ id: 1, value: "A" }, { id: 3, value: "C" }],
};
console.log(convertToYamlWithRefs(data));
```

```yaml
list1:
  - &list1
    id: 1
    value: A
  - id: 2
    value: B
list2:
  - *list1
  - id: 3
    value: C
```

### Tuning with `minSize`

Raise `minSize` to leave small structures inline. Here the shared `address` (3 nodes) is below the threshold, so it is *not* referenced:

```typescript
convertToYamlWithRefs(jsonObject, { minSize: 6 });
```

```yaml
user:
  name: Alice
  address:
    street: 123 Main St
    city: Wonderland
admin:
  name: Bob
  address:
    street: 123 Main St
    city: Wonderland
```

## How it works

1. The input is wrapped in a [`yaml`](https://eemeli.org/yaml/) `Document` (full AST up front).
2. A top-down walk records the first occurrence of each structure (keyed by its serialization).
3. On a repeat, the first occurrence is anchored lazily and the duplicate is replaced with an alias — duplicates are never recursed into, so anchors always point at the first occurrence.
4. `doc.toString()` renders the anchors/aliases.

Non-serializable values (cycles, etc.) are left inline. Aggressively-aliased output can exceed the `yaml` parser's default `maxAliasCount` (100) — pass `{ maxAliasCount: -1 }` to `parse` when reading it back.

## Development

```bash
npm run build   # tsc -> dist/
npm run demo    # convert demo/input.json, print stats, assert lossless round-trip
npm run cli     # run the CLI via tsx
```

## Contributing

Contributions welcome — open an issue or PR for bugs, features, or improvements.

## License

[MIT](LICENSE)
