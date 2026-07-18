// gitnexus/src/core/ingestion/import-resolvers/configs/julia.ts

/**
 * Julia import resolution.
 *
 * Julia has two syntactic import forms plus a file-inclusion mechanism:
 *   using Foo         → bring Foo's exported names into scope
 *   using Foo: a, b   → bring selected names into scope
 *   import Foo        → namespace import (Foo.bar)
 *   import Foo as F   → aliased namespace import
 *   include("f.jl")   → splice a source file into the current module (this is a
 *                       CALL, routed to an import by `routeJuliaCall` in
 *                       languages/julia.ts, then resolved here)
 *
 * `using`/`import` of registered packages (LinearAlgebra, Dates, …) have no
 * local file and resolve to nothing (external). Relative submodule imports
 * (`using .Types`) and `include(...)` resolve to workspace `.jl` files via the
 * shared suffix index (`.jl` is registered in import-resolvers/utils EXTENSIONS).
 */

import { SupportedLanguages } from 'gitnexus-shared';
import type { ImportResolutionConfig, ImportResolverStrategy } from '../types.js';
import { suffixResolve } from '../utils.js';
import { createStandardStrategy } from '../standard.js';

/** Resolve an `include("path/to/file.jl")` target to a workspace file. */
export const juliaIncludeStrategy: ImportResolverStrategy = (rawImportPath, _filePath, ctx) => {
  const cleaned = rawImportPath.replace(/^["']|["']$/g, '');
  if (!cleaned.endsWith('.jl')) return null; // not an include target; let the next strategy try
  const pathParts = cleaned.replace(/^\.\//, '').split('/').filter(Boolean);
  const resolved = suffixResolve(pathParts, ctx.normalizedFileList, ctx.allFileList, ctx.index);
  return resolved ? { kind: 'files', files: [resolved] } : null;
};

export const juliaImportConfig: ImportResolutionConfig = {
  language: SupportedLanguages.Julia,
  strategies: [juliaIncludeStrategy, createStandardStrategy(SupportedLanguages.Julia)],
};
