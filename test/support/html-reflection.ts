import { ElementImpl } from '../../src/browlet/dom/nodes/index';
import { ElementInternalsImpl } from '../../src/browlet/dom/nodes/html/custom-elements/index';
import { DOMTokenListImpl, type TokenListAttribute } from '../../src/browlet/dom/token-list';
import { EnumeratedAttribute } from '../../src/browlet/html/microsyntaxes/index';
import type { AssembledInterface, IDLAttribute, IDLType } from '../../src/web-idl/index';

/** Audit trusted HTML declarations in tests, before preparing their real bindings. */
export function validateReflectedAttribute(member: IDLAttribute, owners: AssembledInterface[]): void {
  if (member.extendedAttributes?.some((attribute) => attribute.kind !== 'raw' &&
    (attribute.name === 'ReflectDefault' || attribute.name === 'ReflectRange'))) {
    throw new Error('Numeric reflection modifiers belong to the reflection annotation.');
  }
  const reflections = member.extendedAttributes?.filter((attribute) => attribute.kind === 'reflection') ?? [];
  if (reflections.length > 1) throw new Error('A reflected attribute has more than one reflection form.');
  const reflection = reflections[0];
  if (!reflection) return;
  if (member.static) throw new Error('Reflection requires an instance attribute.');
  let hasInternals = false;
  for (const owner of owners) {
    const implementation = owner.primary.implementation?.implClass;
    if (implementation === ElementImpl || implementation?.prototype instanceof ElementImpl) continue;
    if (implementation === ElementInternalsImpl || implementation?.prototype instanceof ElementInternalsImpl) {
      hasInternals = true;
    } else {
      throw new Error('Reflection requires an Element or ElementInternals implementation.');
    }
  }
  const mode = reflection.name;
  const type = member.type;
  const nullable = type.kind === 'nullable';
  const inner = nullable ? type.innerType : type;
  const numeric = inner.kind === 'integer' || inner.kind === 'float';
  const defaultLiteral = reflection.default;
  const range: string[] | undefined = reflection.range;
  if (range && (range.length !== 2 ||
    mode !== 'Reflect' || nullable || inner.kind !== 'integer' || inner.name !== 'unsigned long')) {
    throw new Error('[ReflectRange] requires [Reflect] unsigned long and two integer bounds.');
  }
  if (defaultLiteral && (nullable || !numeric ||
    !['long', 'unsigned long', 'double'].includes(inner.name) ||
    defaultLiteral.kind !== (inner.name === 'double' ? 'decimal' : 'integer') ||
    !['Reflect', 'ReflectNonNegative', 'ReflectPositive', 'ReflectPositiveWithFallback'].includes(mode))) {
    throw new Error('[ReflectDefault] requires a numeric reflected attribute and matching numeric literal.');
  }
  if (mode === 'ReflectURL' && (nullable || inner.kind !== 'string' || inner.name !== 'USVString') ||
    mode === 'ReflectNonNegative' && (nullable || inner.kind !== 'integer' || inner.name !== 'long') ||
    (mode === 'ReflectPositive' || mode === 'ReflectPositiveWithFallback') &&
    (nullable || !numeric || (inner.name !== 'unsigned long' && inner.name !== 'double'))) {
    throw new Error('Reflection form is not applicable to this IDL type.');
  }
  if (mode === 'ReflectEnumerated') {
    const definition = reflection.enumerated;
    if (inner.kind !== 'string' || inner.name !== 'DOMString' || !(definition instanceof EnumeratedAttribute)) {
      throw new Error('[ReflectEnumerated] requires DOMString and an enumerated attribute definition.');
    }
  }
  if (mode === 'ReflectTokens' && (nullable || inner.kind !== 'interface' ||
    inner.assembled.primary.implementation?.implClass !== DOMTokenListImpl)) {
    throw new Error('[ReflectTokens] requires DOMTokenList.');
  }
  if (mode === 'ReflectTokens') {
    const attribute = reflection.tokenList as TokenListAttribute | undefined;
    if (typeof attribute?.name !== 'string' ||
      attribute.supportedTokens !== null && !(attribute.supportedTokens instanceof Set)) {
      throw new Error('[ReflectTokens] requires an attribute name and supported-token definition.');
    }
  }
  if (inner.kind === 'string' || inner.kind === 'boolean' || numeric) {
    const primitive = inner.kind === 'boolean' ? 'boolean' : inner.name;
    if (!['DOMString', 'USVString', 'boolean', 'long', 'unsigned long', 'double'].includes(primitive)) {
      throw new Error(`Unsupported reflected IDL type: ${primitive}`);
    }
    if (nullable && primitive !== 'DOMString') throw new Error('Only DOMString and element references have nullable reflection.');
    // SPEC_GAP(reflect-positive-fallback-double): HTML permits this annotation but does not define its behavior.
    if (primitive === 'double' && mode === 'ReflectPositiveWithFallback') {
      throw new Error('HTML does not define positive-with-fallback reflection for double.');
    }
  } else if (inner.kind === 'interface' && inner.assembled.primary.implementation?.implClass === DOMTokenListImpl && !nullable) {
    if (mode !== 'ReflectTokens') throw new Error('DOMTokenList reflection uses [ReflectTokens].');
    if (hasInternals) throw new Error('DOMTokenList reflection requires only Element implementations.');
  } else if (nullable && (inner.kind === 'frozen-array' || inner.kind === 'interface')) {
    validateElementType(inner.kind === 'frozen-array' ? inner.elementType : inner);
  } else {
    throw new Error('Unsupported reflected IDL type.');
  }
}

function validateElementType(type: IDLType): void {
  const implementation = type.kind === 'interface' ? type.assembled.primary.implementation?.implClass : undefined;
  if (!implementation || !(implementation === ElementImpl || implementation.prototype instanceof ElementImpl)) {
    throw new Error('Element reflection requires an Element interface with an implementation.');
  }
}
