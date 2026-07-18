import type {
  CaptureMatch,
  ParsedImport,
  Scope,
  ScopeId,
  ScopeTree,
  TypeRef,
} from 'gitnexus-shared';

/** Julia binding scope: default auto-hoist (innermost enclosing scope). */
export function juliaBindingScopeFor(
  _decl: CaptureMatch,
  _innermost: Scope,
  _tree: ScopeTree,
): ScopeId | null {
  return null;
}

/** Julia import owning scope: default (nearest enclosing Module/Namespace). */
export function juliaImportOwningScope(
  _imp: ParsedImport,
  _innermost: Scope,
  _tree: ScopeTree,
): ScopeId | null {
  return null;
}

/** Julia receiver binding: null. Julia is non-OO — no implicit `self`/`this`. */
export function juliaReceiverBinding(_functionScope: Scope): TypeRef | null {
  return null;
}
