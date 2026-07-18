import { dirname, join } from 'path';
import { isHeritageMarker } from '../../utils/heritage-marker.js';

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
 * The suffix scan is linear over `allFilePaths` (repos are small; correctness
 * over micro-optimization for the first cut) with a fewest-path-components
 * tie-break for determinism, mirroring resolveCImportTarget.
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

/** Return the workspace path ending in `/target` (or equal to it) with the
 *  fewest path components; deterministic lexicographic tie-break. */
function suffixMatch(target: string, allFilePaths: ReadonlySet<string>): string | null {
  const norm = target.replace(/\\/g, '/');
  const suffix = '/' + norm;
  let best: string | null = null;
  let bestDepth = Infinity;
  let bestNorm = '';
  for (const original of allFilePaths) {
    const cand = original.replace(/\\/g, '/');
    if (cand === norm || cand.endsWith(suffix)) {
      const depth = cand.split('/').length;
      if (depth < bestDepth || (depth === bestDepth && cand < bestNorm)) {
        bestDepth = depth;
        best = original;
        bestNorm = cand;
      }
    }
  }
  return best;
}
