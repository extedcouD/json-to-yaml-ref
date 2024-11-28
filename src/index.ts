import { Document, Node, YAMLMap, YAMLSeq } from "yaml";

type RecordAny = Record<string, any>;

export function convertToYamlWithRefs(jsonObject: RecordAny): string {
	const doc = new Document(jsonObject);
	const cache = new Map<string, Node>();

	function serialize(obj: any): string | null {
		try {
			return JSON.stringify(obj);
		} catch {
			return null; // Handle non-serializable values
		}
	}

	function isValidAnchorName(str: string): boolean {
		return /^[a-zA-Z0-9-_]+$/.test(str);
	}

	function manageAnchorsAndAliases(obj: any, path: string[] = []): void {
		if (obj && (typeof obj === "object" || Array.isArray(obj))) {
			const serialized = serialize(obj);
			if (serialized === null) return;

			if (cache.has(serialized)) {
				const node: any = cache.get(serialized);
				doc.setIn(path, doc.createAlias(node));
			} else {
				const node = doc.getIn(path);
				if (node instanceof YAMLMap || node instanceof YAMLSeq) {
					const anchorName = path.join("_");

					if (isValidAnchorName(anchorName)) {
						node.anchor = anchorName;
						cache.set(serialized, node);
					}

					if (Array.isArray(obj)) {
						obj.forEach((item, index) => {
							manageAnchorsAndAliases(item, [...path, index.toString()]);
						});
					} else {
						Object.keys(obj).forEach((key) => {
							manageAnchorsAndAliases(obj[key], [...path, key]);
						});
					}
				}
			}
		}
	}

	manageAnchorsAndAliases(jsonObject);

	return doc.toString();
}
