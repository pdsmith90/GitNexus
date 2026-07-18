import type { CaptureMatch, ParsedImport } from 'gitnexus-shared';

/**
 * Interpret a Julia import capture into a ParsedImport.
 *
 * `using`/`import`/`include(...)` all bring the target module's symbols into
 * scope, so they are modeled as wildcard imports (the file→file IMPORTS edge is
 * the same regardless). Synthetic `__heritage__:` markers (from captures.ts)
 * also flow through here so they reach `parsedImports`; resolveJuliaImportTarget
 * returns null for them (no file edge) and emitJuliaHeritageEdges decodes them.
 */
export function interpretJuliaImport(captures: CaptureMatch): ParsedImport | null {
  const source = captures['@import.source']?.text;
  if (source === undefined || source.length === 0) return null;
  return { kind: 'wildcard', targetRaw: source };
}
