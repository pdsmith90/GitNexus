import type { Callsite, SymbolDefinition } from 'gitnexus-shared';

/**
 * Julia arity compatibility. Julia dispatches on the full argument tuple and
 * uses `args...`/keyword args, so we keep this deliberately permissive: a hard
 * `incompatible` only when the call has fewer args than the def's required
 * count. Everything else is `unknown` (no signal) — the resolver falls back to
 * name-based matching, appropriate for a first-cut multiple-dispatch model.
 */
export function juliaArityCompatibility(
  def: SymbolDefinition,
  callsite: Callsite,
): 'compatible' | 'unknown' | 'incompatible' {
  const min = def.requiredParameterCount;
  if (min === undefined) return 'unknown';
  if (!Number.isFinite(callsite.arity) || callsite.arity < 0) return 'unknown';
  if (callsite.arity < min) return 'incompatible';
  return 'unknown';
}
