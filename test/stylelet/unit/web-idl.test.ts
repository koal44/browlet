import { describe, expect, it } from 'vitest';

import { styleletIDLDefinitions } from '../../../src/stylelet/web-idl';
import { serializeDefinitions } from '../../../src/web-idl/core/index';

describe('Stylelet Web IDL declarations', () => {
  it('exports its host-neutral CSSOM declarations', () => {
    expect(serializeDefinitions([...styleletIDLDefinitions])).toBe(`
typedef DOMString CSSOMString;

[Exposed=Window]
interface MediaList {
  stringifier attribute [LegacyNullToEmptyString] CSSOMString mediaText;
  readonly attribute unsigned long length;
  getter CSSOMString? item(unsigned long index);
  undefined appendMedium(CSSOMString medium);
  undefined deleteMedium(CSSOMString medium);
};

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
