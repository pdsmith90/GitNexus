// gitnexus/src/core/ingestion/type-extractors/julia.ts

import type {
  LanguageTypeConfig,
  ParameterExtractor,
  TypeBindingExtractor,
  InitializerExtractor,
  ConstructorBindingScanner,
  PendingAssignmentExtractor,
} from './types.js';
import { extractSimpleTypeName, extractVarName } from './shared.js';
import type { SyntaxNode } from '../utils/ast-helpers.js';

/**
 * Julia type extractor — feeds local variable → type bindings used by call
 * resolution.
 *
 * Julia type annotations use `::` (`typed_expression`, e.g. `x::Int`), and
 * `assignment` has NO `left`/`right` fields (verified against tree-sitter-julia
 * 0.23.1), so every access here is positional. Constructor inference: an
 * assignment `obj = MyType(args...)` binds `obj → MyType` when `MyType` is a
 * known type name.
 */

const DECLARATION_NODE_TYPES: ReadonlySet<string> = new Set(['function_definition', 'assignment']);

/** LHS / RHS of an `assignment` (children are `[lhs, operator, rhs]`, no fields). */
function assignmentSides(node: SyntaxNode): { lhs?: SyntaxNode; rhs?: SyntaxNode } {
  const sides = node.namedChildren.filter((c) => c.type !== 'operator');
  return { lhs: sides[0], rhs: sides[sides.length - 1] };
}

/** The `argument_list` of a `function_definition`'s signature, if any. */
function signatureArgumentList(node: SyntaxNode): SyntaxNode | undefined {
  const signature = node.namedChildren.find((n) => n.type === 'signature');
  const call = signature?.namedChildren.find((n) => n.type === 'call_expression');
  return call?.namedChildren.find((n) => n.type === 'argument_list');
}

/** Bind a `typed_expression` (`name::Type`) into env. */
function bindTypedExpression(te: SyntaxNode, env: Map<string, string>): void {
  const nameNode = te.firstNamedChild;
  const typeNode = te.namedChild(1);
  if (!nameNode || !typeNode) return;
  const varName = extractVarName(nameNode);
  const typeName = extractSimpleTypeName(typeNode) ?? typeNode.text?.trim();
  if (varName && typeName) env.set(varName, typeName);
}

/** `function foo(x::Int, y)` → env{ x: "Int" }. Untyped params contribute nothing. */
const extractDeclaration: TypeBindingExtractor = (node, env) => {
  if (node.type !== 'function_definition') return;
  const args = signatureArgumentList(node);
  if (!args) return;
  for (const param of args.namedChildren) {
    if (param.type === 'typed_expression') {
      bindTypedExpression(param, env);
    } else if (param.type === 'assignment') {
      // Default param: `x::T = v` — the LHS may be a typed_expression.
      const { lhs } = assignmentSides(param);
      if (lhs?.type === 'typed_expression') bindTypedExpression(lhs, env);
    }
  }
};

const extractParameter: ParameterExtractor = () => {
  // Parameter types are handled by extractDeclaration above.
};

/** `obj = MyType(args...)` binds `obj → MyType` when MyType is a known type. */
const extractInitializer: InitializerExtractor = (node, env, classNames) => {
  if (node.type !== 'assignment') return;
  const { lhs, rhs } = assignmentSides(node);
  if (!lhs || !rhs) return;
  const varName = extractVarName(lhs);
  if (!varName || env.has(varName)) return;
  if (rhs.type === 'call_expression') {
    const callee = rhs.firstNamedChild;
    if (callee?.type === 'identifier' && classNames.has(callee.text)) {
      env.set(varName, callee.text);
    }
  }
};

const scanConstructorBinding: ConstructorBindingScanner = (node) => {
  if (node.type !== 'assignment') return undefined;
  const { lhs, rhs } = assignmentSides(node);
  if (!lhs || !rhs) return undefined;
  const varName = extractVarName(lhs);
  if (!varName) return undefined;
  if (rhs.type === 'call_expression') {
    const callee = rhs.firstNamedChild;
    if (callee?.type === 'identifier') {
      return { varName, calleeName: callee.text };
    }
  }
  return undefined;
};

const extractPendingAssignment: PendingAssignmentExtractor = (node, scopeEnv) => {
  if (node.type !== 'assignment') return undefined;
  const { lhs, rhs } = assignmentSides(node);
  if (lhs?.type !== 'identifier' || !rhs) return undefined;
  const varName = lhs.text;
  if (scopeEnv.has(varName)) return undefined;
  if (rhs.type === 'identifier') return { kind: 'copy', lhs: varName, rhs: rhs.text };
  if (rhs.type === 'call_expression') {
    const callee = rhs.firstNamedChild;
    if (callee?.type === 'identifier') {
      return { kind: 'callResult', lhs: varName, callee: callee.text };
    }
  }
  return undefined;
};

export const typeConfig: LanguageTypeConfig = {
  declarationNodeTypes: DECLARATION_NODE_TYPES,
  extractDeclaration,
  extractParameter,
  extractInitializer,
  scanConstructorBinding,
  extractPendingAssignment,
};
