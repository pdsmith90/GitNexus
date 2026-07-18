// gitnexus/src/core/ingestion/variable-extractors/configs/julia.ts

import { SupportedLanguages } from 'gitnexus-shared';
import type { VariableExtractionConfig, VariableVisibility } from '../../variable-types.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

/**
 * Julia const extraction (→ Const nodes; enriches the @definition.const captures).
 *
 * `const NAME = expr` parses as `const_statement → assignment → identifier`.
 * We only model module/file-scoped `const` (including const type aliases such as
 * `const Vec3 = NTuple{3,Float64}`). Plain local assignments are intentionally not
 * captured as Variable nodes — that would flood the graph with per-statement noise.
 */

/** const_statement → assignment; the assignment's first named child is the name
 *  (`identifier`) or, for the rare `const x::T = v`, a `typed_expression`. */
function constLhs(node: SyntaxNode): SyntaxNode | undefined {
  const assignment = node.namedChildren.find((c) => c.type === 'assignment');
  return assignment?.firstNamedChild;
}

function extractName(node: SyntaxNode): string | undefined {
  const lhs = constLhs(node);
  if (lhs?.type === 'identifier') return lhs.text;
  if (lhs?.type === 'typed_expression') return lhs.firstNamedChild?.text;
  return undefined;
}

function extractType(node: SyntaxNode): string | undefined {
  const lhs = constLhs(node);
  if (lhs?.type === 'typed_expression') return lhs.namedChild(1)?.text?.trim();
  return undefined;
}

function extractVisibility(node: SyntaxNode): VariableVisibility {
  const name = extractName(node);
  return name && name.startsWith('_') ? 'private' : 'public';
}

export const juliaVariableConfig: VariableExtractionConfig = {
  language: SupportedLanguages.Julia,
  constNodeTypes: ['const_statement'],
  staticNodeTypes: [],
  variableNodeTypes: [],
  extractName,
  extractType,
  extractVisibility,
  isConst: (node) => node.type === 'const_statement',
  isStatic: () => false,
  isMutable: () => false,
};
