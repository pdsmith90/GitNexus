import type { ParsedFile } from 'gitnexus-shared';
import { SupportedLanguages } from 'gitnexus-shared';
import { buildMro, defaultLinearize } from '../../scope-resolution/passes/mro.js';
import { populateClassOwnedMembers, isClassLike } from '../../scope-resolution/scope/walkers.js';
import type { ScopeResolver } from '../../scope-resolution/contract/scope-resolver.js';
import { resolveDefGraphId } from '../../scope-resolution/graph-bridge/ids.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
import type { KnowledgeGraph } from '../../../graph/types.js';
import { generateId } from '../../../../lib/utils.js';
import { decodeMarker } from '../../utils/heritage-marker.js';
import { juliaProvider } from '../julia.js';
import { juliaArityCompatibility } from './arity.js';
import { juliaMergeBindings } from './merge-bindings.js';
import { resolveJuliaImportTarget } from './import-target.js';

/**
 * Emit EXTENDS edges from `struct/abstract Sub <: Super` subtyping.
 *
 * captures.ts encodes each `<:` as a `__heritage__:extends:Sub:Super` marker on
 * the import channel (rather than `@reference.inherits`) specifically so we emit
 * EXTENDS here instead of the shared pre-pass's IMPLEMENTS (every Julia supertype
 * is an abstract type = Interface node, which that pre-pass would classify as
 * IMPLEMENTS). Names are resolved to graph ids by full qualified name, then by
 * simple tail name; a same-tail collision maps to null and we refuse to guess.
 */
function emitJuliaHeritageEdges(
  graph: KnowledgeGraph,
  parsedFiles: readonly ParsedFile[],
  nodeLookup: GraphNodeLookup,
): void {
  const graphIdByName = new Map<string, string>();
  const graphIdByTail = new Map<string, string | null>();
  for (const parsed of parsedFiles) {
    for (const def of parsed.localDefs) {
      if (!isClassLike(def.type)) continue;
      const gid = resolveDefGraphId(parsed.filePath, def, nodeLookup);
      if (gid === undefined) continue;
      const fq = def.qualifiedName ?? '';
      if (fq.length === 0) continue;
      graphIdByName.set(fq, gid);
      const tail = fq.split('.').pop() ?? fq;
      if (tail.length === 0) continue;
      const existing = graphIdByTail.get(tail);
      if (existing === undefined) graphIdByTail.set(tail, gid);
      else if (existing !== null && existing !== gid) graphIdByTail.set(tail, null);
    }
  }

  const lookup = (name: string): string | undefined => {
    const byName = graphIdByName.get(name);
    if (byName !== undefined) return byName;
    const byTail = graphIdByTail.get(name);
    return byTail ?? undefined; // null (collision) → undefined → skip
  };

  const emitted = new Set<string>();
  for (const rel of graph.iterRelationshipsByType('EXTENDS')) {
    emitted.add(`${rel.sourceId}->${rel.targetId}`);
  }

  for (const parsed of parsedFiles) {
    for (const imp of parsed.parsedImports) {
      if (typeof imp.targetRaw !== 'string') continue;
      const decoded = decodeMarker(imp.targetRaw);
      if (decoded?.kind !== 'heritage') continue;
      const [kind, subName, supName] = decoded.fields;
      if (kind !== 'extends' || subName === undefined || supName === undefined) continue;
      const subId = lookup(subName);
      const supId = lookup(supName);
      if (subId === undefined || supId === undefined) continue;
      const key = `${subId}->${supId}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      graph.addRelationship({
        id: generateId('EXTENDS', key),
        sourceId: subId,
        targetId: supId,
        type: 'EXTENDS',
        confidence: 0.9,
        reason: 'julia-subtype',
      });
    }
  }
}

/**
 * Julia `ScopeResolver` (RFC #909 Ring 3). Structurally the C resolver shape
 * (non-OO, wildcard imports, global free-call fallback) plus EXTENDS synthesis
 * for `<:` subtyping. Multiple dispatch has no single-receiver MRO, so `buildMro`
 * uses the shared EXTENDS-chain linearization only (mroStrategy 'qualified-syntax'
 * on the provider suppresses fabricated single-parent method overrides).
 */
export const juliaScopeResolver: ScopeResolver = {
  language: SupportedLanguages.Julia,
  languageProvider: juliaProvider,
  importEdgeReason: 'julia-scope: import',

  resolveImportTarget: (targetRaw, fromFile, allFilePaths) =>
    resolveJuliaImportTarget(targetRaw, fromFile, allFilePaths),

  mergeBindings: (existing, incoming, scopeId) => juliaMergeBindings(existing, incoming, scopeId),

  arityCompatibility: (callsite, def) => juliaArityCompatibility(def, callsite),

  buildMro: (graph, parsedFiles, nodeLookup) =>
    buildMro(graph, parsedFiles, nodeLookup, defaultLinearize),

  populateOwners: (parsed: ParsedFile) => populateClassOwnedMembers(parsed),

  isSuperReceiver: () => false,

  emitHeritageEdges: (graph, parsedFiles, nodeLookup) =>
    emitJuliaHeritageEdges(graph, parsedFiles, nodeLookup),

  // Julia is dynamically typed with no field-based method dispatch; a bare
  // `foo(x)` resolves to a unique top-level `foo` via the global fallback.
  fieldFallbackOnMethodLookup: false,
  propagatesReturnTypesAcrossImports: false,
  allowGlobalFreeCallFallback: true,
};
