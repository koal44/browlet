import { describe, expect, it } from 'vitest';

import { loadingAttribute } from '../../../../../../src/browlet/dom/nodes/html/attributes/loading';

describe('HTML lazy loading attribute', () => {
  it.each(['lazy', 'eager'] as const)('recognizes %s and ASCII case variants', (state) => {
    for (const value of [state, state.toUpperCase()]) {
      expect(loadingAttribute.getState(value)).toBe(state);
      expect(loadingAttribute.isValidValue(value)).toBe(true);
    }
    expect(loadingAttribute.getCanonicalKeyword(state)).toBe(state);
  });

  it.each([null, '', 'auto', 'invalid', ' lazy', 'lazy ', '\tlazy\n', 'laſy'])(
    'uses eager loading for %j without trimming or recovering a keyword', (value) => {
      expect(loadingAttribute.getState(value)).toBe('eager');
      if (value !== null) expect(loadingAttribute.isValidValue(value)).toBe(false);
    },
  );
});
