import { describe, expect, it } from 'vitest';

import { styleletIDLDefinitions } from '../../../src/stylelet/web-idl';
import { mediaListIDL } from '../../../src/stylelet/cssom/media/media-list';
import { serializeDefinitions } from '../../../src/web-idl/core/index';

describe('Stylelet Web IDL declarations', () => {
  it('declares MediaList conversion and legacy collection behavior', () => {
    expect(serializeDefinitions([mediaListIDL])).toBe(`
[Exposed=Window]
interface MediaList {
  stringifier attribute [LegacyNullToEmptyString] CSSOMString mediaText;
  readonly attribute unsigned long length;
  getter CSSOMString? item(unsigned long index);
  undefined appendMedium(CSSOMString medium);
  undefined deleteMedium(CSSOMString medium);
};`.trim());
  });

  it('declares typed sheet and declaration results across the host boundary', () => {
    const declarations = serializeDefinitions(styleletIDLDefinitions);
    expect(declarations).toContain('typedef DOMString CSSOMString;');
    expect(declarations).toContain('[SameObject, PutForwards=cssText] readonly attribute CSSStyleProperties style;');
    expect(declarations).toContain('readonly attribute CSSStyleSheet? sheet;');
    expect(declarations).toContain('[NewObject] CSSStyleProperties getComputedStyle(Element elt, optional CSSOMString? pseudoElt);');
    expect(declarations).toContain('getter CSSRule? item(unsigned long index);');
  });
});
