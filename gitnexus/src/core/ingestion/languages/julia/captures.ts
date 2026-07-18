import type { Capture, CaptureMatch } from 'gitnexus-shared';
import { nodeToCapture, syntheticCapture, type SyntaxNode } from '../../utils/ast-helpers.js';
import { encodeMarker } from '../../utils/heritage-marker.js';
import { getJuliaParser, getJuliaScopeQuery } from './query.js';
import { getTreeSitterBufferSize } from '../../constants.js';
import { parseSourceSafe } from '../../../tree-sitter/safe-parse.js';

/**
 * Julia scope captures (RFC #909 Ring 3): scopes, declarations, call
 * references, and imports for the scope-resolution pass.
 *
 * Julia-specific handling on top of the generic query→group loop:
 *  - **Self-call suppression:** the call_expression in a `function f(…)` /
 *    `macro m(…)` signature and the LHS call of a short-form `f(x) = …` are the
 *    definition's own name, and the free-call query matches them. We drop those
 *    so a function does not appear to call itself.
 *  - **`include("f.jl")` → import:** Julia assembles modules by splicing files,
 *    so an `include` call is routed to a wildcard import (resolved to a `.jl`
 *    file by resolveJuliaImportTarget), mirroring how Ruby routes `require`.
 *  - **Heritage (`<:`) → EXTENDS:** `struct/abstract Sub <: Super` is emitted as
 *    a `__heritage__:extends:Sub:Super` marker on the import channel and turned
 *    into an EXTENDS edge by emitJuliaHeritageEdges. We deliberately do NOT emit
 *    `@reference.inherits`, because the shared inheritance pre-pass would label a
 *    subtype-of-an-Interface (every Julia supertype is an abstract type =
 *    Interface node) as IMPLEMENTS rather than the requested EXTENDS.
 */
export function emitJuliaScopeCaptures(
  sourceText: string,
  filePath: string,
  cachedTree?: unknown,
): readonly CaptureMatch[] {
  let tree = cachedTree as ReturnType<ReturnType<typeof getJuliaParser>['parse']> | undefined;
  if (tree === undefined) {
    tree = parseSourceSafe(getJuliaParser(), sourceText, undefined, {
      bufferSize: getTreeSitterBufferSize(sourceText),
    });
  }

  const rawMatches = getJuliaScopeQuery().matches(tree.rootNode);
  const out: CaptureMatch[] = [];

  for (const m of rawMatches) {
    const grouped: Record<string, Capture> = {};
    const nodeMap: Record<string, SyntaxNode> = {};
    for (const c of m.captures) {
      const tag = '@' + c.name;
      if (tag.startsWith('@_')) continue;
      grouped[tag] = nodeToCapture(tag, c.node);
      nodeMap[tag] = c.node;
    }
    if (Object.keys(grouped).length === 0) continue;

    // using / import statements → structured import capture.
    if (grouped['@import.statement'] !== undefined) {
      const stmt = nodeMap['@import.statement'];
      const source = juliaImportSource(stmt);
      if (source !== null) {
        out.push(buildImportCapture(stmt, source));
      }
      continue;
    }

    // Call references.
    const callNode = nodeMap['@reference.call.free'] ?? nodeMap['@reference.call.member'];
    if (callNode !== undefined) {
      // Suppress a definition's own name (signature call / short-form LHS call).
      if (isDefinitionNameCall(callNode)) continue;
      // Route include("path.jl") to an import.
      const callee = grouped['@reference.name']?.text;
      if (callee === 'include' && nodeMap['@reference.call.free'] !== undefined) {
        const importCapture = buildIncludeImport(callNode);
        if (importCapture !== null) out.push(importCapture);
        continue;
      }
    }

    out.push(grouped);
  }

  // Synthesize heritage markers for `<:` subtyping (→ EXTENDS).
  collectHeritage(tree.rootNode, out);

  return out;
}

/** The `<:` binary_expression inside a struct/abstract head has children
 *  `[Sub, <:, Super]`; return the two named identifier endpoints. */
function subtypePair(head: SyntaxNode): { sub: string; sup: string } | null {
  const binary = head.namedChildren.find((c) => c.type === 'binary_expression');
  if (binary === undefined) return null;
  const idents = binary.namedChildren.filter((c) => c.type === 'identifier');
  if (idents.length < 2) return null;
  const sub = idents[0].text;
  const sup = idents[idents.length - 1].text;
  // Marker fields are ':'-delimited; a qualified super like `Mod.Super` is fine
  // (no colon), but guard against anything unexpected.
  if (sub.includes(':') || sup.includes(':')) return null;
  return { sub, sup };
}

function collectHeritage(root: SyntaxNode, out: CaptureMatch[]): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'struct_definition' || node.type === 'abstract_definition') {
      const head = node.namedChildren.find((c) => c.type === 'type_head');
      const pair = head ? subtypePair(head) : null;
      if (pair !== null) {
        const marker = encodeMarker('heritage', ['extends', pair.sub, pair.sup]);
        out.push({
          '@import.statement': nodeToCapture('@import.statement', node),
          '@import.kind': syntheticCapture('@import.kind', node, 'wildcard'),
          '@import.source': syntheticCapture('@import.source', node, marker),
        });
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child !== null) stack.push(child);
    }
  }
}

/** True when a matched call_expression is actually a definition's own name:
 *  the signature call of `function f(…)`/`macro m(…)`, or the LHS call of a
 *  short-form `f(x) = …` (the first named child of the enclosing assignment). */
function isDefinitionNameCall(callNode: SyntaxNode): boolean {
  const parent = callNode.parent;
  if (parent === null) return false;
  if (parent.type === 'signature') return true;
  if (parent.type === 'assignment' && parent.firstNamedChild?.id === callNode.id) return true;
  return false;
}

/** Extract the module reference text from a using_statement / import_statement. */
function juliaImportSource(node: SyntaxNode): string | null {
  const first = node.namedChild(0);
  if (first === null) return null;
  if (first.type === 'identifier' || first.type === 'import_path') return first.text;
  if (first.type === 'import_alias') {
    // `import Foo as F` — the module is the first child of import_alias.
    const inner = first.namedChild(0);
    return inner?.text ?? null;
  }
  if (first.type === 'selected_import') {
    // `using Foo: a, b` — the module is the leading import_path/identifier.
    const mod = first.namedChildren.find(
      (c) => c.type === 'import_path' || c.type === 'identifier',
    );
    return mod?.text ?? null;
  }
  return null;
}

function buildImportCapture(stmt: SyntaxNode, source: string): CaptureMatch {
  return {
    '@import.statement': nodeToCapture('@import.statement', stmt),
    '@import.kind': syntheticCapture('@import.kind', stmt, 'wildcard'),
    '@import.source': syntheticCapture('@import.source', stmt, source),
  };
}

/** Build an import capture from an `include("path.jl")` call. */
function buildIncludeImport(callNode: SyntaxNode): CaptureMatch | null {
  const args = callNode.namedChildren.find((n) => n.type === 'argument_list');
  const literal = args?.namedChildren.find((n) => n.type === 'string_literal');
  const content = literal?.namedChildren.find((n) => n.type === 'content');
  const raw = content?.text?.trim();
  if (raw === undefined || raw.length === 0 || raw.length > 1024 || /[\x00-\x1f]/.test(raw)) {
    return null;
  }
  return {
    '@import.statement': nodeToCapture('@import.statement', callNode),
    '@import.kind': syntheticCapture('@import.kind', callNode, 'wildcard'),
    '@import.source': syntheticCapture('@import.source', callNode, raw),
  };
}
