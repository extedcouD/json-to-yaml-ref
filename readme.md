# JSON to YAML with References

Convert JSON objects to YAML with automatic anchors and aliases, enabling efficient and readable YAML files by reusing common structures through references.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Automatic Anchors & Aliases:** Detects and manages duplicate objects, creating YAML anchors and aliases to reduce redundancy.
- **Deep Object Support:** Handles complex nested JSON structures, including arrays and objects.
- **Customizable Anchor Naming:** Generates meaningful anchor names based on the object's path.
- **Simple Integration:** Easy to use with minimal setup.

## Installation

Install the package via npm:

```bash
npm install json-to-yaml-with-refs
```

Or using yarn:

```bash
yarn add json-to-yaml-with-refs
```

## Usage

Import the `convertToYamlWithRefs` function and use it to convert your JSON objects to YAML with references.

```typescript
import { convertToYamlWithRefs } from "json-to-yaml-with-refs";

const jsonObject = {
	user: {
		name: "Alice",
		address: {
			street: "123 Main St",
			city: "Wonderland",
		},
	},
	admin: {
		name: "Bob",
		address: {
			street: "123 Main St",
			city: "Wonderland",
		},
	},
};

const yamlString = convertToYamlWithRefs(jsonObject);
console.log(yamlString);
```

**Output:**

```yaml
user: &user_address
  name: Alice
  address:
    street: 123 Main St
    city: Wonderland
admin:
  name: Bob
  address: *user_address
```

## API

### `convertToYamlWithRefs(jsonObject: Record<string, any>): string`

Converts a JSON object to a YAML string with anchors and aliases for duplicate objects.

#### Parameters

- `jsonObject` _(Record<string, any>)_: The JSON object to convert.

#### Returns

- `string`: The resulting YAML string with references.

## Examples

### Basic Conversion

```typescript
const data = {
	project: {
		name: "Example",
		settings: {
			theme: "dark",
			layout: "grid",
		},
	},
	backup: {
		settings: {
			theme: "dark",
			layout: "grid",
		},
	},
};

const yaml = convertToYamlWithRefs(data);
console.log(yaml);
```

**Output:**

```yaml
project:
  settings: &project_settings
    theme: dark
    layout: grid
backup:
  settings: *project_settings
```

### Handling Arrays

```typescript
const data = {
	list1: [
		{ id: 1, value: "A" },
		{ id: 2, value: "B" },
	],
	list2: [
		{ id: 1, value: "A" },
		{ id: 3, value: "C" },
	],
};

const yaml = convertToYamlWithRefs(data);
console.log(yaml);
```

**Output:**

```yaml
list1:
  - id: 1
    value: A
  - id: 2
    value: B
list2:
  - *list1_0
  - id: 3
    value: C
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any bugs, features, or improvements.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/YourFeature`)
3. Commit your changes (`git commit -m 'Add some feature'`)
4. Push to the branch (`git push origin feature/YourFeature`)
5. Open a pull request

## License

This project is licensed under the [MIT License](LICENSE).

---

Feel free to customize this README to better fit your project's specific details and requirements.
