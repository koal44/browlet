import { describe, expect, it } from 'vitest';

import * as declaration from '../../../src/web-idl/declaration/index';
import * as webIDL from '../../../src/web-idl/index';

describe('Web IDL package surface', () => {
  it('exposes declarations, binding metadata, and registration only', () => {
    expect(Object.keys(webIDL).sort()).toEqual([
      ...Object.keys(declaration),
      'bind',
      'registerInterfaceBindings',
    ].sort());
  });
});
