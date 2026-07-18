/**
 * Julia language provider.
 *
 * Julia is NOT object-oriented. A "method" is a dispatch of a top-level generic
 * function selected by the tuple of all argument types (multiple dispatch), not
 * a member of its first argument's struct. Consequences baked into this provider:
 *   - We emit top-level Function nodes only (via @definition.function) and set
 *     NO methodExtractor — so no Method / HAS_METHOD nodes are ever produced.
 *   - mroStrategy is 'qualified-syntax' (same as Rust): suppresses fabricated
 *     single-parent METHOD_OVERRIDES between same-named dispatches. A dedicated
 *     'multiple-dispatch' strategy is an open design question deferred to the
 *     scope-resolver work (languages/julia/).
 *   - Structs are data (fields only); abstract types map to Interface nodes.
 *
 * `include("file.jl")` is Julia's file-splicing mechanism (this is how modules
 * are assembled). It parses as a call, so we route it to an import via
 * `routeJuliaCall` and resolve it in import-resolvers/configs/julia.ts.
 *
 * Heritage (`<:`) EXTENDS edges and precise call resolution are produced by the
 * scope-resolution layer (languages/julia/), not here.
 */

import { SupportedLanguages } from 'gitnexus-shared';
import { defineLanguage } from '../language-provider.js';
import { JULIA_QUERIES } from '../tree-sitter-queries.js';
import { juliaExportChecker } from '../export-detection.js';
import { createImportResolver } from '../import-resolvers/resolver-factory.js';
import { juliaImportConfig } from '../import-resolvers/configs/julia.js';
import { createClassExtractor } from '../class-extractors/generic.js';
import { juliaClassConfig } from '../class-extractors/configs/julia.js';
import { createFieldExtractor } from '../field-extractors/generic.js';
import { juliaFieldConfig } from '../field-extractors/configs/julia.js';
import { createVariableExtractor } from '../variable-extractors/generic.js';
import { juliaVariableConfig } from '../variable-extractors/configs/julia.js';
import { createCallExtractor } from '../call-extractors/generic.js';
import { juliaCallConfig } from '../call-extractors/configs/julia.js';
import { typeConfig as juliaTypeConfig } from '../type-extractors/julia.js';
import {
  emitJuliaScopeCaptures,
  interpretJuliaImport,
  juliaArityCompatibility,
  juliaBindingScopeFor,
  juliaImportOwningScope,
  juliaReceiverBinding,
} from './julia/index.js';
import type { CallRoutingResult } from '../call-routing.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';

const CALL_RESULT = { kind: 'call' } as const;
const SKIP_RESULT = { kind: 'skip' } as const;

/**
 * Classify a Julia call node.
 *  - The call_expression in a `function f(…)` / `macro m(…)` signature, and the
 *    LHS call of a short-form `f(x) = …`, are the definition's own name — skip
 *    them so a function does not appear to call itself.
 *  - `include("path.jl")` → import (path resolved by the Julia import resolver).
 *  - everything else → a normal call.
 */
function routeJuliaCall(calledName: string, callNode: SyntaxNode): CallRoutingResult {
  const parent = callNode.parent;
  if (parent?.type === 'signature') return SKIP_RESULT;
  // Short-form definition LHS: `f(x) = …` — the call is the assignment's first
  // named child (the RHS, if a call, is a real call and is NOT skipped).
  if (parent?.type === 'assignment' && parent.firstNamedChild?.id === callNode.id) {
    return SKIP_RESULT;
  }

  if (calledName === 'include') {
    const args =
      callNode.childForFieldName('arguments') ??
      callNode.namedChildren.find((n) => n.type === 'argument_list');
    const literal = args?.namedChildren.find((n) => n.type === 'string_literal');
    const content = literal?.namedChildren.find((n) => n.type === 'content');
    const importPath = content?.text?.trim();
    // Call-routed imports bypass the standard path cleaner, so validate here.
    if (!importPath || importPath.length > 1024 || /[\x00-\x1f]/.test(importPath)) {
      return SKIP_RESULT;
    }
    return { kind: 'import', importPath, isRelative: true };
  }

  return CALL_RESULT;
}

/** Julia Base functions filtered from the call graph as noise. */
const BUILT_INS: ReadonlySet<string> = new Set([
  'print',
  'println',
  'typeof',
  'length',
  'size',
  'push!',
  'pop!',
  'append!',
  'map',
  'filter',
  'reduce',
  'foldl',
  'foldr',
  'sum',
  'prod',
  'minimum',
  'maximum',
  'sort',
  'sort!',
  'collect',
  'enumerate',
  'zip',
  'keys',
  'values',
  'haskey',
  'get',
  'get!',
  'getindex',
  'setindex!',
  'error',
  'throw',
  'isa',
  'isdefined',
  'isnothing',
  'ismissing',
  'isempty',
  'eltype',
  'zeros',
  'ones',
  'rand',
  'randn',
  'copy',
  'deepcopy',
  'string',
  'Symbol',
  'parse',
  'convert',
  'promote',
  'similar',
  'fill',
  'repeat',
  'reshape',
  'hcat',
  'vcat',
  'cat',
  'tuple',
  'nameof',
  'supertype',
  'subtypes',
  'abs',
  'min',
  'max',
  'round',
  'floor',
  'ceil',
  'mod',
]);

export const juliaProvider = defineLanguage({
  id: SupportedLanguages.Julia,
  extensions: ['.jl'],
  entryPointPatterns: [/^main$/, /^run$/, /^execute$/],
  treeSitterQueries: JULIA_QUERIES,
  typeConfig: juliaTypeConfig,
  exportChecker: juliaExportChecker,
  importResolver: createImportResolver(juliaImportConfig),
  callRouter: routeJuliaCall,
  // 'qualified-syntax' opts Julia out of single-parent override fabrication —
  // correct for multiple dispatch (see header). No methodExtractor is set, so
  // no Method/HAS_METHOD nodes are produced.
  mroStrategy: 'qualified-syntax',
  callExtractor: createCallExtractor(juliaCallConfig),
  fieldExtractor: createFieldExtractor(juliaFieldConfig),
  variableExtractor: createVariableExtractor(juliaVariableConfig),
  classExtractor: createClassExtractor(juliaClassConfig),
  builtInNames: BUILT_INS,
  // ── Scope-based resolution (RFC #909 Ring 3) — see languages/julia/ ──
  //    emitScopeCaptures + interpretImport drive CALLS/IMPORTS; EXTENDS is
  //    synthesized in the ScopeResolver (emitJuliaHeritageEdges). The other
  //    hooks are non-OO no-op stubs. interpretTypeBinding is intentionally
  //    omitted: Julia has no receiver typing to feed method resolution.
  emitScopeCaptures: emitJuliaScopeCaptures,
  interpretImport: interpretJuliaImport,
  arityCompatibility: juliaArityCompatibility,
  bindingScopeFor: juliaBindingScopeFor,
  importOwningScope: juliaImportOwningScope,
  receiverBinding: juliaReceiverBinding,
});
