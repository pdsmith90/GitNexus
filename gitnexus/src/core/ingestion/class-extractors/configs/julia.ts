// gitnexus/src/core/ingestion/class-extractors/configs/julia.ts

import { SupportedLanguages } from 'gitnexus-shared';
import type { ClassExtractionConfig, ClassLikeNodeLabel } from '../../class-types.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

/**
 * Julia class-like config for qualified-name derivation.
 *
 * `struct` → Struct, `abstract type` → Interface (per the semantic mapping in
 * JULIA_SUPPORT_BRIEF.md; abstract types carry no data, only a contract +
 * hierarchy position). Julia is non-OO, so there are no methods-as-members —
 * this config only names the type and scopes it under enclosing modules.
 *
 * The name lives under `type_head` (no `name:` field), so both the generic
 * default label map and its default name extraction miss it — we supply both.
 */

/** struct/abstract name: `type_head → identifier` (simple) or
 *  `type_head → binary_expression → first identifier` (the `Foo` in `Foo <: Bar`). */
function extractTypeHeadName(node: SyntaxNode): string | undefined {
  const typeHead = node.namedChildren.find((c) => c.type === 'type_head');
  const first = typeHead?.firstNamedChild;
  if (first?.type === 'identifier') return first.text;
  if (first?.type === 'binary_expression') return first.firstNamedChild?.text;
  return undefined;
}

function extractLabel(node: SyntaxNode): ClassLikeNodeLabel | undefined {
  if (node.type === 'struct_definition') return 'Struct';
  if (node.type === 'abstract_definition') return 'Interface';
  return undefined;
}

export const juliaClassConfig: ClassExtractionConfig = {
  language: SupportedLanguages.Julia,
  typeDeclarationNodes: ['struct_definition', 'abstract_definition'],
  ancestorScopeNodeTypes: ['module_definition'],
  extractName: extractTypeHeadName,
  extractType: extractLabel,
};
