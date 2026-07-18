// gitnexus/src/core/ingestion/call-extractors/configs/julia.ts

import { SupportedLanguages } from 'gitnexus-shared';
import type { CallExtractionConfig } from '../../call-types.js';

// Julia call sites (`f(x)`, `recv.method(x)`, `f.(x)`) are captured by
// JULIA_QUERIES as @call/@call.name and handled by the generic extractor path;
// no language-specific call-shape override is needed.
export const juliaCallConfig: CallExtractionConfig = {
  language: SupportedLanguages.Julia,
};
