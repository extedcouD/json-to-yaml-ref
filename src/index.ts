import {
    Document,
    Scalar,
    YAMLMap,
    YAMLSeq,
    isAlias,
    isCollection,
    isPair,
    visit,
} from "yaml";

type RecordAny = Record<string, any>;
type AnchorNode = YAMLMap | YAMLSeq | Scalar;

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
    /**
     * Upper bound on the alias "score" the output is allowed to reach, where
     * score is the `yaml` parser's resource-exhaustion metric
     * (`count * aliasCount` per anchor — see the billion-laughs guard). The
     * library drops the heaviest refs until every anchor stays at or below
     * this value, so the result always parses with `yaml.parse()` instead of
     * throwing "Excessive alias count indicates a resource exhaustion attack".
     *
     * Default 100 (matches the parser's default `maxAliasCount`). Set to a
     * negative number to disable the guard and alias unboundedly (the old
     * behaviour — output may then need `parse(yaml, { maxAliasCount: -1 })`).
     */
    maxAliasCount?: number;
}

const DEFAULTS: Required<ConvertOptions> = {
    matchMode: "canonical",
    minSize: 1,
    includeScalars: false,
    maxAliasCount: 100,
};

export function convertToYamlWithRefs(
    jsonObject: RecordAny,
    options: ConvertOptions = {}
): string {
    const opts = { ...DEFAULTS, ...options };
    const doc = new Document(jsonObject);

    // First surviving occurrence of each structure, keyed by its serialization.
    // `aliasPaths` records every position we turned into an alias to this
    // node, so the ref can be undone (inlined) later if it blows the budget.
    const seen = new Map<
        string,
        { node: AnchorNode; path: string[]; aliasPaths: string[][] }
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
            prev.aliasPaths.push(path);
            return; // never recurse into a duplicate
        }

        const node = doc.getIn(path, true);
        if (node instanceof YAMLMap || node instanceof YAMLSeq) {
            seen.set(serialized, { node, path, aliasPaths: [] });
            recurse(obj, path);
        } else if (opts.includeScalars && node instanceof Scalar) {
            seen.set(serialized, { node, path, aliasPaths: [] });
        }
    }

    walk(jsonObject, []);

    if (opts.maxAliasCount >= 0) {
        enforceAliasBudget(jsonObject, doc, seen, opts.maxAliasCount);
    }

    return doc.toString();
}

/**
 * Drop the heaviest anchors until the document's worst alias score is within
 * `budget`, mirroring the `yaml` parser's billion-laughs metric
 * (`count * aliasCount` per anchor, where nested aliases compound
 * multiplicatively). We only ever demote "leaf" anchors — ones whose source
 * contains no nested aliases — so a demotion can never inflate another
 * anchor's count; the worst score is therefore non-increasing and the loop
 * terminates (worst case: every ref removed → plain YAML).
 */
function enforceAliasBudget(
    jsonObject: RecordAny,
    doc: Document,
    seen: Map<string, { node: AnchorNode; path: string[]; aliasPaths: string[][] }>,
    budget: number
): void {
    const nodeToPaths = new Map<AnchorNode, string[][]>();
    for (const entry of seen.values()) {
        if (entry.node.anchor) nodeToPaths.set(entry.node, entry.aliasPaths);
    }

    // Replace every alias to `node` with an inlined clone, and drop its anchor.
    function demote(node: AnchorNode): void {
        const paths = nodeToPaths.get(node) || [];
        for (const p of paths) {
            const copy = node.clone() as AnchorNode;
            copy.anchor = undefined;
            doc.setIn(p, copy);
        }
        node.anchor = undefined;
        nodeToPaths.delete(node);
    }

    // One pass over the doc: anchor-name → node, and alias-count per anchor.
    function scan(): { byName: Map<string, AnchorNode>; aliasCounts: Map<string, number> } {
        const byName = new Map<string, AnchorNode>();
        const aliasCounts = new Map<string, number>();
        visit(doc, {
            Node(_key, node) {
                if (node.anchor) byName.set(node.anchor, node as AnchorNode);
            },
            Alias(_key, node) {
                aliasCounts.set(node.source, (aliasCounts.get(node.source) || 0) + 1);
            },
        });
        return { byName, aliasCounts };
    }

    const cap = nodeToPaths.size + 1;
    for (let pass = 0; pass < cap; pass++) {
        const { byName, aliasCounts } = scan();
        if (byName.size === 0) break;

        const scoreMemo = new Map<AnchorNode, number>();
        const acMemo = new Map<any, number>();

        // score(anchor) = count * aliasCount — the parser's per-anchor metric.
        function score(node: AnchorNode): number {
            const cached = scoreMemo.get(node);
            if (cached !== undefined) return cached;
            scoreMemo.set(node, 0); // cycle guard (data is acyclic, belt-and-suspenders)
            const count = 1 + (aliasCounts.get(node.anchor!) || 0);
            const s = count * aliasCount(node);
            scoreMemo.set(node, s);
            return s;
        }

        // aliasCount(n) = max compounded score of any alias nested in n's
        // subtree (1 if none) — exactly the parser's getAliasCount.
        function aliasCount(n: any): number {
            const cached = acMemo.get(n);
            if (cached !== undefined) return cached;
            let result: number;
            if (isAlias(n)) {
                const target = byName.get(n.source);
                result = target ? score(target) : 0;
            } else if (isCollection(n)) {
                let mx = 1;
                for (const item of (n as any).items) {
                    const c = aliasCount(item);
                    if (c > mx) mx = c;
                }
                result = mx;
            } else if (isPair(n)) {
                result = Math.max(aliasCount(n.key), aliasCount(n.value));
            } else {
                result = 1;
            }
            acMemo.set(n, result);
            return result;
        }

        // Worst-scoring anchor this pass.
        let worst: AnchorNode | null = null;
        let worstScore = 0;
        for (const node of byName.values()) {
            const s = score(node);
            if (s > worstScore) {
                worstScore = s;
                worst = node;
            }
        }
        if (!worst || worstScore <= budget) break;

        // Descend the worst chain to its leaf anchor (no nested aliases), so
        // the demotion strips a real factor off the offending product.
        demote(leafOfChain(worst, byName, score, aliasCount));
    }

    // Safety net: if our metric ever disagreed with the parser, fall back to
    // ref-free YAML (always parseable, always lossless).
    try {
        doc.toJS({ maxAliasCount: budget });
    } catch {
        const plain = new Document(jsonObject);
        doc.contents = plain.contents;
    }
}

// Follow `node`'s heaviest alias chain down to the leaf anchor that has no
// nested aliases of its own.
function leafOfChain(
    node: AnchorNode,
    byName: Map<string, AnchorNode>,
    score: (n: AnchorNode) => number,
    aliasCount: (n: any) => number
): AnchorNode {
    const ac = aliasCount(node);
    if (ac <= 1) return node; // already a leaf
    const next = findChainTarget(node, ac, byName, score);
    return next ? leafOfChain(next, byName, score, aliasCount) : node;
}

// Find an alias inside `n`'s subtree whose target's score equals `target`
// (i.e. the nested alias responsible for n's aliasCount).
function findChainTarget(
    n: any,
    target: number,
    byName: Map<string, AnchorNode>,
    score: (node: AnchorNode) => number
): AnchorNode | null {
    let found: AnchorNode | null = null;
    const rec = (x: any): void => {
        if (found) return;
        if (isAlias(x)) {
            const t = byName.get(x.source);
            if (t && score(t) === target) found = t;
            return;
        }
        if (isCollection(x)) for (const item of (x as any).items) rec(item);
        else if (isPair(x)) {
            rec(x.key);
            rec(x.value);
        }
    };
    if (isCollection(n)) for (const item of n.items) rec(item);
    else if (isPair(n)) {
        rec(n.key);
        rec(n.value);
    }
    return found;
}
