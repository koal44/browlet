import { describe, expect, it } from 'vitest';

import { ElementImpl } from '../../../../src/browlet/dom/nodes/index';
import { ElementInternalsImpl } from '../../../../src/browlet/dom/nodes/html/custom-elements/index';
import { EnumeratedAttribute } from '../../../../src/browlet/html/microsyntaxes/index';
import {
  attr, defineIncludes, defineInterface, defineInterfaceMixin, frozenArray, idlType, impl, integer, nullable,
  reference, reflect, reflectSetter, reflectURL, reflectNonNegative, reflectPositive,
  reflectPositiveWithFallback, reflectEnumerated, reflectTokens, xattr,
  type AttributeMember,
} from '../../../../src/web-idl/index';
import { createReflectionWorld, tokensAttribute } from './fixture';

describe('HTML reflection declaration audit', () => {
  it('accepts production declarations and the representative reflection fixtures', () => {
    expect(() => createReflectionWorld()).not.toThrow();
  });

  it('rejects reflection on a non-element owner, including a later mixin includer', () => {
    class ValidImpl extends ElementImpl {}
    class InvalidImpl {}
    expect(() => createReflectionWorld([
      defineInterfaceMixin({ name: 'SharedReflection', members: [attr('label', idlType.DOMString, xattr(reflect()))] }),
      defineInterface({ name: 'Valid', inherits: 'Element', implementation: impl(ValidImpl), members: [] }),
      defineInterface({ name: 'Invalid', implementation: impl(InvalidImpl), members: [] }),
      defineIncludes({ interface: 'Valid', mixin: 'SharedReflection' }),
      defineIncludes({ interface: 'Invalid', mixin: 'SharedReflection' }),
    ])).toThrow('Reflection requires an Element or ElementInternals implementation.');
  });

  it('rejects static reflection because it has no element receiver', () => {
    expect(() => prepare({ ...attr('value', idlType.DOMString, xattr(reflect())), static: true }))
      .toThrow('Reflection requires an instance attribute.');
  });

  it('rejects token-list reflection on ElementInternals in the declaration audit', () => {
    class InvalidInternalsImpl extends ElementInternalsImpl {}
    expect(() => createReflectionWorld([defineInterface({
      name: 'InvalidInternals', inherits: 'ElementInternals', implementation: impl(InvalidInternalsImpl),
      members: [attr('tokens', reference('DOMTokenList'), xattr(reflectTokens(tokensAttribute)))],
    })])).toThrow('DOMTokenList reflection requires only Element implementations.');
  });

  it.each([
    ['primitive', idlType.DOMString],
    ['non-Element interface', reference('Node')],
  ])('rejects a reflected array of %s items', (_description, itemType) => {
    expect(() => prepare(attr('targets', nullable(frozenArray(itemType)), xattr(reflect()))))
      .toThrow('Element reflection requires an Element interface with an implementation.');
  });

  it('rejects incompatible reflection forms after assembly, before exposing an attribute', () => {
    const invalid = [
      attr('value', idlType.DOMString, xattr(reflectURL())),
      attr('value', idlType.unsignedLong, xattr(reflectNonNegative())),
      attr('value', idlType.long, xattr(reflectPositive())),
      attr('value', idlType.USVString, xattr(reflect(), reflectSetter())),
      attr('value', idlType.double, xattr(reflect({ default: 1 }))),
      attr('value', idlType.long, xattr(reflect({ range: [0, 8] }))),
      attr('value', idlType.DOMString, xattr(reflectEnumerated(undefined))),
      attr('value', idlType.long, xattr(reflectEnumerated(new EnumeratedAttribute([])))),
      attr('value', reference('DOMTokenList'), xattr(reflect())),
      attr('value', idlType.DOMString, xattr(reflectTokens(tokensAttribute))),
    ];
    for (const member of invalid) expect(() => prepare(member)).toThrow();
  });

  it.each([
    [reflectURL({ default: 1 }), idlType.USVString],
    [reflectSetter({ default: 1 }), idlType.long],
    [reflectNonNegative({ range: [0, 8] }), idlType.long],
    [reflectPositive({ range: [1, 10] }), idlType.unsignedLong],
    [reflectPositiveWithFallback({ range: [1, 10] }), idlType.unsignedLong],
  ])('rejects unsupported numeric options on $0.name in the declaration audit', (reflection, type) => {
    expect(() => prepare(attr('value', type, xattr(reflection))))
      .toThrow(reflection.range ? '[ReflectRange]' : '[ReflectDefault]');
  });

  it('rejects numeric metadata on enumerated and token-list reflection', () => {
    const enumerated = reflectEnumerated(new EnumeratedAttribute([]));
    enumerated.default = integer(1);
    const tokens = reflectTokens(tokensAttribute);
    tokens.range = ['1', '10'];
    expect(() => prepare(attr('value', idlType.DOMString, xattr(enumerated)))).toThrow('[ReflectDefault]');
    expect(() => prepare(attr('value', reference('DOMTokenList'), xattr(tokens)))).toThrow('[ReflectRange]');
  });

  it.each(['ReflectDefault', 'ReflectRange'])('rejects a standalone %s modifier', (name) => {
    expect(() => prepare(attr('value', idlType.unsignedLong, xattr(name))))
      .toThrow('Numeric reflection modifiers belong to the reflection annotation.');
    expect(() => prepare(attr('value', idlType.unsignedLong, xattr(reflect(), name))))
      .toThrow('Numeric reflection modifiers belong to the reflection annotation.');
  });

  it.each([42, {}])('rejects an invalid opaque enumerated definition during setup: %j', (enumerated) => {
    expect(() => prepare(attr('value', idlType.DOMString, xattr(reflectEnumerated(enumerated)))))
      .toThrow('[ReflectEnumerated] requires DOMString and an enumerated attribute definition.');
  });

  it('keeps the unused double-with-fallback specification gap explicit', () => {
    expect(() => prepare(attr('value', idlType.double, xattr(reflectPositiveWithFallback()))))
      .toThrow('HTML does not define positive-with-fallback reflection for double.');
  });

  it.each([undefined, {}, { name: 'tokens' }])('rejects incomplete token-list definitions during setup: %j', (tokenList) => {
    expect(() => prepare(attr('tokens', reference('DOMTokenList'), xattr(reflectTokens(tokenList)))))
      .toThrow('[ReflectTokens] requires an attribute name and supported-token definition.');
  });
});

function prepare(member: AttributeMember) {
  class InvalidReflectionImpl extends ElementImpl {}
  return createReflectionWorld([defineInterface({
    name: 'InvalidReflection', inherits: 'Element', implementation: impl(InvalidReflectionImpl), members: [member],
  })]);
}
