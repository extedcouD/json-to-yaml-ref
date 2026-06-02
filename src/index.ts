import { Document, Scalar, YAMLMap, YAMLSeq } from "yaml";

type RecordAny = Record<string, any>;

export interface ConvertOptions {
    /**
     * How two structures are compared for equality.
     * - "canonical" (default): object key order is ignored, so more matches
     *   are found. Aliased copies adopt the first occurrence's key order
     *   (semantically lossless for mappings).
     * - "exact": key order is significant. Byte-faithful, fewer matches.
     */
    matchMode?: "canonical" | "exact";
    /**
     * Minimum node count (collections + scalars in the subtree, self
     * included) for a structure to be eligible for referencing.
     * Default 1 = reference everything that repeats.
     */
    minSize?: number;
    /** Also dedup repeated scalar values. Default false (structures only). */
    includeScalars?: boolean;
}

const DEFAULTS: Required<ConvertOptions> = {
    matchMode: "canonical",
    minSize: 1,
    includeScalars: false,
};

export function convertToYamlWithRefs(
    jsonObject: RecordAny,
    options: ConvertOptions = {}
): string {
    const opts = { ...DEFAULTS, ...options };
    const doc = new Document(jsonObject);

    // First surviving occurrence of each structure, keyed by its serialization.
    const seen = new Map<
        string,
        { node: YAMLMap | YAMLSeq | Scalar; path: string[] }
    >();
    const usedNames = new Set<string>();
    const sizeCache = new WeakMap<object, number>();

    function sizeOf(obj: any): number {
        if (!obj || typeof obj !== "object") return 1;
        const cached = sizeCache.get(obj);
        if (cached !== undefined) return cached;
        let n = 1;
        if (Array.isArray(obj)) for (const v of obj) n += sizeOf(v);
        else for (const k of Object.keys(obj)) n += sizeOf(obj[k]);
        sizeCache.set(obj, n);
        return n;
    }

    function canonical(obj: any): any {
        if (Array.isArray(obj)) return obj.map(canonical);
        if (obj && typeof obj === "object") {
            const out: RecordAny = {};
            for (const k of Object.keys(obj).sort()) out[k] = canonical(obj[k]);
            return out;
        }
        return obj;
    }

    function serialize(obj: any): string | null {
        try {
            return JSON.stringify(
                opts.matchMode === "canonical" ? canonical(obj) : obj
            );
        } catch {
            return null; // non-serializable (cycles, etc.) → cannot dedup
        }
    }

    function sanitize(str: string): string {
        const cleaned = str.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[-_]+/, "");
        return cleaned.length ? cleaned : "ref";
    }

    // Anchor name from the nearest non-numeric path key (readable, always valid).
    function anchorBase(path: string[]): string {
        for (let i = path.length - 1; i >= 0; i--) {
            if (!/^\d+$/.test(path[i])) return sanitize(path[i]);
        }
        return "ref";
    }

    function uniqueName(base: string): string {
        let name = base;
        let i = 2;
        while (usedNames.has(name)) name = `${base}_${i++}`;
        usedNames.add(name);
        return name;
    }

    function recurse(obj: any, path: string[]): void {
        if (Array.isArray(obj)) {
            obj.forEach((item, i) => walk(item, [...path, String(i)]));
        } else {
            for (const k of Object.keys(obj)) walk(obj[k], [...path, k]);
        }
    }

    function walk(obj: any, path: string[]): void {
        const isColl = !!obj && typeof obj === "object";
        if (obj === null || obj === undefined) return;
        if (!isColl && !opts.includeScalars) return; // scalars off by default

        // Too small to be worth referencing; descendants are smaller still.
        if (sizeOf(obj) < opts.minSize) return;

        const serialized = serialize(obj);
        if (serialized === null) {
            if (isColl) recurse(obj, path);
            return;
        }

        const prev = seen.get(serialized);
        if (prev) {
            // Duplicate: anchor the first occurrence (lazily) and alias here.
            if (!prev.node.anchor) {
                prev.node.anchor = uniqueName(anchorBase(prev.path));
            }
            doc.setIn(path, doc.createAlias(prev.node));
            return; // never recurse into a duplicate
        }

        const node = doc.getIn(path, true);
        if (node instanceof YAMLMap || node instanceof YAMLSeq) {
            seen.set(serialized, { node, path });
            recurse(obj, path);
        } else if (opts.includeScalars && node instanceof Scalar) {
            seen.set(serialized, { node, path });
        }
    }

    walk(jsonObject, []);

    return doc.toString();
}
