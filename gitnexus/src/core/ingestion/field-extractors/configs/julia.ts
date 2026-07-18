// gitnexus/src/core/ingestion/field-extractors/configs/julia.ts

import { SupportedLanguages } from 'gitnexus-shared';
import type { FieldExtractionConfig } from '../generic.js';
import type { SyntaxNode } from '../../utils/ast-helpers.js';

/**
 * Julia struct field extraction (→ HAS_PROPERTY edges).
 *
 * Julia struct fields are direct children of `struct_definition` (there is no
 * body-container node), so we return the struct node itself as its own "body"
 * via `findBodyNodes` and let the factory iterate its children. The `type_head`
 * child (struct name / supertype) is excluded because it is not one of the
 * `fieldNodeTypes`.
 *
 * Field shapes handled (all seen in CubeOH):
 *   identifier         → bare untyped field:            `label`
 *   typed_expression   → typed field:                   `x::Float64`
 *   assignment         → field with default (@kwdef):   `x::Int = 1` / `flag = false`
 */
function extractStructOwnerName(node: SyntaxNode): string | undefined {
  const typeHead = node.namedChildren.find((c) => c.type === 'type_head');
  const first = typeHead?.firstNamedChild;
  if (first?.type === 'identifier') return first.text;
  // struct Foo <: Bar  →  binary_expression, first identifier is the struct name
  if (first?.type === 'binary_expression') return first.firstNamedChild?.text;
  return undefined;
}

function extractFieldName(node: SyntaxNode): string | undefined {
  if (node.type === 'identifier') return node.text;
  if (node.type === 'typed_expression') return node.firstNamedChild?.text;
  if (node.type === 'assignment') {
    const lhs = node.firstNamedChild;
    if (lhs?.type === 'typed_expression') return lhs.firstNamedChild?.text;
    if (lhs?.type === 'identifier') return lhs.text;
  }
  return undefined;
}

function extractFieldType(node: SyntaxNode): string | undefined {
  if (node.type === 'typed_expression') return node.namedChild(1)?.text?.trim();
  if (node.type === 'assignment') {
    const lhs = node.firstNamedChild;
    if (lhs?.type === 'typed_expression') return lhs.namedChild(1)?.text?.trim();
  }
  return undefined;
}

export const juliaFieldConfig: FieldExtractionConfig = {
  language: SupportedLanguages.Julia,
  typeDeclarationNodes: ['struct_definition'],
  fieldNodeTypes: ['identifier', 'typed_expression', 'assignment'],
  bodyNodeTypes: [],
  // Fields are direct children of struct_definition — use the struct as its own body.
  findBodyNodes: (node) => [node],
  extractOwnerName: extractStructOwnerName,
  defaultVisibility: 'public',
  extractName: extractFieldName,
  extractType: extractFieldType,
  // Julia has no field-level visibility modifiers (the module export list governs
  // the public surface, which is handled by the export checker, not per field).
  extractVisibility: () => 'public',
  isStatic: () => false,
  isReadonly: () => false,
};
