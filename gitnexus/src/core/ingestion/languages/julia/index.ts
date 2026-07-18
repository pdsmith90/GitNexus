/**
 * Julia scope-resolution hooks (RFC #909 Ring 3).
 */
export { emitJuliaScopeCaptures } from './captures.js';
export { interpretJuliaImport } from './interpret.js';
export { juliaArityCompatibility } from './arity.js';
export { juliaMergeBindings } from './merge-bindings.js';
export {
  juliaBindingScopeFor,
  juliaImportOwningScope,
  juliaReceiverBinding,
} from './simple-hooks.js';
export { resolveJuliaImportTarget } from './import-target.js';
