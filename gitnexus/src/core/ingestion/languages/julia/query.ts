import Parser from 'tree-sitter';
import { SupportedLanguages } from 'gitnexus-shared';
import { getLanguageGrammar } from '../../../tree-sitter/parser-loader.js';

/**
 * Julia scope-resolution query (RFC #909 Ring 3).
 *
 * Distinct from `JULIA_QUERIES` in tree-sitter-queries.ts (that drives the
 * parse-phase node extraction). This query feeds the scope-resolution pass:
 * scopes, declarations, call references, and imports. Heritage (`<:`) is NOT
 * captured here — it is synthesized in captures.ts as a heritage marker so the
 * resolver can emit EXTENDS (not the pipeline's default IMPLEMENTS).
 *
 * Julia is non-OO: functions are top-level generics (a "method" is a dispatch),
 * so there are no method-of-a-class declarations and no receiver type bindings.
 */
const JULIA_SCOPE_QUERY = `
;; Scopes
(source_file) @scope.module
(module_definition) @scope.namespace
(struct_definition) @scope.class
(abstract_definition) @scope.class
(function_definition) @scope.function

;; Declarations — struct (Struct) — simple head and \`Sub <: Super\` head
(struct_definition (type_head (identifier) @declaration.name)) @declaration.struct
(struct_definition
  (type_head (binary_expression . (identifier) @declaration.name))) @declaration.struct

;; Declarations — abstract type (Interface)
(abstract_definition (type_head (identifier) @declaration.name)) @declaration.interface
(abstract_definition
  (type_head (binary_expression . (identifier) @declaration.name))) @declaration.interface

;; Declarations — functions (long form + short form \`f(x) = …\`)
(function_definition
  (signature (call_expression . (identifier) @declaration.name))) @declaration.function
(assignment . (call_expression . (identifier) @declaration.name)) @declaration.function

;; Declarations — const
(const_statement (assignment . (identifier) @declaration.name)) @declaration.const

;; Imports — using / import (the module reference is decomposed in captures.ts)
(using_statement) @import.statement
(import_statement) @import.statement

;; References — free calls  f(args...)
(call_expression . (identifier) @reference.name) @reference.call.free

;; References — qualified / member calls  Mod.foo(args...)
(call_expression
  (field_expression value: (_) @reference.receiver (identifier) @reference.name)) @reference.call.member
`;

let _parser: Parser | null = null;
let _query: Parser.Query | null = null;

export function getJuliaParser(): Parser {
  if (_parser === null) {
    _parser = new Parser();
    _parser.setLanguage(
      getLanguageGrammar(SupportedLanguages.Julia) as Parameters<Parser['setLanguage']>[0],
    );
  }
  return _parser;
}

export function getJuliaScopeQuery(): Parser.Query {
  if (_query === null) {
    _query = new Parser.Query(
      getLanguageGrammar(SupportedLanguages.Julia) as Parameters<Parser['setLanguage']>[0],
      JULIA_SCOPE_QUERY,
    );
  }
  return _query;
}
