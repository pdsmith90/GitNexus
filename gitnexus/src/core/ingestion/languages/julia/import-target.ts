import { dirname, join } from 'path';
import { isHeritageMarker } from '../../utils/heritage-marker.js';
import { perFileSet } from '../../import-resolvers/per-file-set.js';

/**
 * Resolve a Julia import/include target to a workspace `.jl` file.
 *
 * Handled forms (all `targetRaw` from captures.ts):
 *   - `include("path/to/f.jl")`  → suffix-match the `.jl` path
 *   - `using .Types` / `using ..A.B` / `import Foo` → module reference; strip
 *     leading relative dots, try `<dotted/path>.jl` then `<lastSegment>.jl`
 *   - registered packages (`LinearAlgebra`, `Dates`) → no local file → null
 *   - synthetic `__heritage__:` markers → null (handled by emitJuliaHeritageEdges)
 *
 * Suffix lookup goes through `juliaSuffixIndex`, a per-file-set memo, so N
 * imports cost one pass over the workspace rather than N (the property in
 * `test/unit/scope-resolution/import-target-index-reuse.contract.test.ts`).
 * The winner rule is unchanged: fewest path components, lexicographic
 * tie-break for determinism.
 */
export function resolveJuliaImportTarget(
  targetRaw: string,
  fromFile: string,
  allFilePaths: ReadonlySet<string>,
): string | null {
  if (!targetRaw || isHeritageMarker(targetRaw)) return null;
  const cleaned = targetRaw.replace(/^["']|["']$/g, '');

  if (cleaned.endsWith('.jl')) {
    const rel = cleaned.replace(/^\.\//, '');
    // Same-directory sibling first (include is relative to the including file).
    if (fromFile) {
      const sibling = join(dirname(fromFile), rel).replace(/\\/g, '/');
      if (allFilePaths.has(sibling)) return sibling;
    }
    return suffixMatch(rel, allFilePaths);
  }

  // Module reference: `.Types` → Types, `..A.B` → A.B
  const mod = cleaned.replace(/^\.+/, '');
  if (mod.length === 0) return null;
  const segments = mod.split('.');
  const candidates = [`${segments.join('/')}.jl`, `${segments[segments.length - 1]}.jl`];
  for (const cand of candidates) {
    const hit = suffixMatch(cand, allFilePaths);
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * Segment-boundary suffix -> the winning workspace path, built once per file set.
 *
 * Replaces a full `allFilePaths` scan per import. This cannot reuse the shared
 * `getWorkspaceFileIndex`: that index answers with the FIRST path in Set
 * iteration order carrying a suffix, whereas Julia resolves to the SHALLOWEST
 * one (fewest path components, lexicographic tie-break). Preserving that rule
 * is the point — it is what makes `include("Types.jl")` deterministic when a
 * repo carries several `Types.jl`.
 *
 * Only `.jl` paths are indexed. Every target reaching here ends in `.jl` (the
 * include branch is guarded on it and the module branch builds `<name>.jl`
 * candidates), and a match requires whole-path equality or a `/`-aligned
 * suffix, so no other extension could ever win. Skipping them keeps the memo
 * proportional to the Julia sources rather than to the whole polyglot workspace.
 */
const juliaSuffixIndex = perFileSet((allFilePaths: ReadonlySet<string>) => {
  const best = new Map<string, { path: string; depth: number; norm: string }>();
  for (const original of allFilePaths) {
    const norm = original.replace(/\\/g, '/');
    if (!norm.endsWith('.jl')) continue;
    const segments = norm.split('/');
    const depth = segments.length;
    for (let i = 0; i < segments.length; i++) {
      const key = segments.slice(i).join('/');
      const prev = best.get(key);
      if (!prev || depth < prev.depth || (depth === prev.depth && norm < prev.norm)) {
        best.set(key, { path: original, depth, norm });
      }
    }
  }
  return best;
});

/** Return the workspace path ending in `/target` (or equal to it) with the
 *  fewest path components; deterministic lexicographic tie-break. */
function suffixMatch(target: string, allFilePaths: ReadonlySet<string>): string | null {
  const norm = target.replace(/\\/g, '/');
  return juliaSuffixIndex(allFilePaths).get(norm)?.path ?? null;
}
