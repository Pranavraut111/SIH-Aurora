import { describe, expect, it } from 'vitest';
import { layoutDepths } from './graphLayout';

describe('layoutDepths', () => {
  it('puts each node one column after its deepest input', () => {
    const ids = ['storage', 'generator', 'heating', 'lq'];
    const edges = [
      { source: 'storage', target: 'generator' }, { source: 'generator', target: 'heating' },
      { source: 'generator', target: 'lq' }, { source: 'heating', target: 'lq' },
    ];
    expect(layoutDepths(ids, edges)).toEqual({ storage: 0, generator: 1, heating: 2, lq: 3 });
  });
});
