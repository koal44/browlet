import { describe, expect, it } from 'vitest';

import { styleletIDLDefinitions } from '../../../src/stylelet/web-idl';
import { serializeDefinitions } from '../../../src/web-idl/declaration/index';

describe('Stylelet Web IDL declarations', () => {
  it('exports its host-neutral CSSOM mixin contribution', () => {
    expect(serializeDefinitions([...styleletIDLDefinitions])).toBe(`
partial interface mixin DocumentOrShadowRoot {
  [SameObject] readonly attribute object styleSheets;
  attribute any adoptedStyleSheets;
};

interface mixin ElementCSSInlineStyle {
  [SameObject, PutForwards=cssText] readonly attribute object style;
};

interface mixin LinkStyle {
  readonly attribute object? sheet;
};`.trim());
  });
});
