/**
 * Julia: non-OO extraction + scope resolution.
 *
 * Covers the full Julia support surface on a two-file fixture:
 *   - top-level generic Function nodes (never Method / HAS_METHOD)
 *   - Struct nodes + HAS_PROPERTY for typed fields
 *   - abstract type → Interface node
 *   - `<:` subtyping → EXTENDS edges (Struct → Interface)
 *   - Module + Macro nodes
 *   - include(...) → IMPORTS edge (file → file)
 *   - free-call resolution (unique-name functions) → CALLS edges
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import {
  FIXTURES,
  getRelationships,
  getNodesByLabel,
  edgeSet,
  runPipelineFromRepo,
  type PipelineResult,
} from './helpers.js';

describe('Julia extraction & scope resolution', () => {
  let result: PipelineResult;

  beforeAll(async () => {
    result = await runPipelineFromRepo(path.join(FIXTURES, 'julia-resolution'), () => {});
  }, 60000);

  it('emits top-level Function nodes (long- and short-form)', () => {
    const fns = getNodesByLabel(result, 'Function');
    expect(fns).toContain('area'); // short-form `area(c::Circle) = …`
    expect(fns).toContain('describe'); // long-form
    expect(fns).toContain('scale_circle');
    expect(fns).toContain('main');
  });

  it('emits Struct nodes and an Interface node for the abstract type', () => {
    expect(getNodesByLabel(result, 'Struct')).toEqual(expect.arrayContaining(['Circle', 'Square']));
    expect(getNodesByLabel(result, 'Interface')).toContain('Shape');
  });

  it('emits Module and Macro nodes', () => {
    expect(getNodesByLabel(result, 'Module')).toEqual(
      expect.arrayContaining(['Geometry', 'App']),
    );
    expect(getNodesByLabel(result, 'Macro')).toContain('logshape');
  });

  it('is non-OO: emits NO Method nodes and NO HAS_METHOD edges', () => {
    expect(getNodesByLabel(result, 'Method')).toEqual([]);
    expect(getRelationships(result, 'HAS_METHOD')).toEqual([]);
  });

  it('emits HAS_PROPERTY for struct fields', () => {
    const edges = edgeSet(getRelationships(result, 'HAS_PROPERTY'));
    expect(edges).toContain('Circle → radius');
    expect(edges).toContain('Square → side');
  });

  it('emits EXTENDS (not IMPLEMENTS) for `<:` subtyping', () => {
    const edges = edgeSet(getRelationships(result, 'EXTENDS'));
    expect(edges).toContain('Circle → Shape');
    expect(edges).toContain('Square → Shape');
    // The `<:` relationship must be EXTENDS, never IMPLEMENTS.
    expect(getRelationships(result, 'IMPLEMENTS')).toEqual([]);
  });

  it('resolves include(...) into a file → file IMPORTS edge', () => {
    const edges = edgeSet(getRelationships(result, 'IMPORTS'));
    expect(edges).toContain('app.jl → geometry.jl');
  });

  it('resolves free calls to unique top-level functions (CALLS)', () => {
    const edges = edgeSet(getRelationships(result, 'CALLS'));
    // Both callees are unique-name functions, so the global free-call fallback
    // resolves them (multiple-dispatch names like `area` are ambiguous and are
    // intentionally not asserted here — a first-cut resolver limitation).
    expect(edges).toContain('main → scale_circle');
    expect(edges).toContain('main → describe');
  });
});
