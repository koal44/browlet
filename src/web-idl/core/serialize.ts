import type {
  ArgumentDefinition, ConstantValue, DefaultValue, Definition, Exposure, ExtendedAttribute,
  WebIDLType,
} from './definition';
import type { AsyncIterableMember, InterfaceMember } from './definitions/interface';
import type { DictionaryMember } from './definitions/dictionary';

// Project formatter: join definition fragments using the Definitions production (Web IDL, IDL grammar).
export function serializeDefinitions<Realm>(
  definitions: Definition<Realm>[],
): string {
  return definitions.map(serializeDefinition).join('\n\n');
}

// Project formatter for Web IDL §2 Interface definition language — definition syntax.
export function serializeDefinition<Realm>(definition: Definition<Realm>): string {
  const attributes = serializeAttributes(definition);
  const prefix = attributes === '' ? '' : `${attributes}\n`;

  switch (definition.kind) {
    case 'interface':
      return prefix + serializeBlock(
        `interface ${serializeIdentifier(definition.name)}`
        + serializeInheritance(definition.inherits),
        definition.members.map(serializeMember),
      );
    case 'partial-interface':
      return prefix + serializeBlock(
        `partial interface ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'interface-mixin':
      return prefix + serializeBlock(
        `interface mixin ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'partial-interface-mixin':
      return prefix + serializeBlock(
        `partial interface mixin ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'callback-interface':
      return prefix + serializeBlock(
        `callback interface ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'namespace':
      return prefix + serializeBlock(
        `namespace ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'partial-namespace':
      return prefix + serializeBlock(
        `partial namespace ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeMember),
      );
    case 'dictionary':
      return prefix + serializeBlock(
        `dictionary ${serializeIdentifier(definition.name)}`
        + serializeInheritance(definition.inherits),
        definition.members.map(serializeDictionaryMember),
      );
    case 'partial-dictionary':
      return prefix + serializeBlock(
        `partial dictionary ${serializeIdentifier(definition.name)}`,
        definition.members.map(serializeDictionaryMember),
      );
    case 'enumeration':
      return prefix + `enum ${serializeIdentifier(definition.name)} { `
        + definition.values.map(serializeString).join(', ')
        + ' };';
    case 'callback-function':
      return prefix + `callback ${serializeIdentifier(definition.name)} = `
        + `${serializeType(definition.returns)}(`
        + `${definition.arguments.map(serializeArgument).join(', ')});`;
    case 'typedef':
      return prefix + `typedef ${serializeType(definition.type)} `
        + `${serializeIdentifier(definition.name)};`;
    case 'includes':
      return prefix + `${serializeIdentifier(definition.interface)} includes `
        + `${serializeIdentifier(definition.mixin)};`;
  }
}

// Project formatter for Web IDL §2.5 Members — member syntax.
export function serializeMember<Realm>(
  member: InterfaceMember<Realm>,
): string {
  const prefix = serializeInlineAttributes(member);

  switch (member.kind) {
    case 'constant':
      return prefix + `const ${serializeType(member.type)} `
        + `${serializeIdentifier(member.name)} = `
        + `${serializeConstantValue(member.value)};`;
    case 'attribute':
      return prefix + serializeAttribute(member);
    case 'operation': {
      const modifier = member.static
        ? 'static '
        : member.special === undefined ? '' : `${member.special} `;
      const name = member.name === undefined
        ? ''
        : ` ${serializeIdentifier(member.name, operationNameKeywords)}`;
      return prefix + modifier + serializeType(member.returns) + name
        + `(${member.arguments.map(serializeArgument).join(', ')});`;
    }
    case 'constructor':
      return prefix + `constructor(`
        + `${member.arguments.map(serializeArgument).join(', ')});`;
    case 'stringifier':
      return `${prefix}stringifier;`;
    case 'iterable':
      return prefix + `iterable<${serializeOptionalKey(member.key)}`
        + `${serializeType(member.value)}>;`;
    case 'async-iterable':
      return prefix + serializeAsyncIterable(member);
    case 'maplike':
      return prefix + (member.readonly ? 'readonly ' : '')
        + `maplike<${serializeType(member.key)}, `
        + `${serializeType(member.value)}>;`;
    case 'setlike':
      return prefix + (member.readonly ? 'readonly ' : '')
        + `setlike<${serializeType(member.value)}>;`;
  }
}

// Project formatter for Web IDL §2.13 Types — type syntax.
export function serializeType(type: WebIDLType): string {
  switch (type.kind) {
    case 'simple':
      return type.name;
    case 'reference':
      return serializeIdentifier(type.name);
    case 'nullable':
      return `${serializeType(type.type)}?`;
    case 'union':
      return `(${type.types.map(serializeType).join(' or ')})`;
    case 'sequence':
      return `sequence<${serializeType(type.type)}>`;
    case 'async-sequence':
      return `async_sequence<${serializeType(type.type)}>`;
    case 'record':
      return `record<${serializeType(type.key)}, ${serializeType(type.value)}>`;
    case 'promise':
      return `Promise<${serializeType(type.type)}>`;
    case 'frozen-array':
      return `FrozenArray<${serializeType(type.type)}>`;
    case 'observable-array':
      return `ObservableArray<${serializeType(type.type)}>`;
    case 'annotated':
      return `[${type.extendedAttributes.map(serializeExtendedAttribute)
        .join(', ')}] ${serializeType(type.type)}`;
  }
}

// Project formatter for Web IDL §2.14 Extended attributes — extended attribute syntax.
export function serializeExtendedAttribute(
  attribute: ExtendedAttribute,
): string {
  switch (attribute.kind) {
    case 'no-arguments':
      return serializeIdentifier(attribute.name);
    case 'arguments':
      return `${serializeIdentifier(attribute.name)}(`
        + `${attribute.arguments.map(serializeArgument).join(', ')})`;
    case 'identifier':
      return `${serializeIdentifier(attribute.name)}=`
        + serializeIdentifier(attribute.value);
    case 'string':
      return `${serializeIdentifier(attribute.name)}=`
        + serializeString(attribute.value);
    case 'integer':
    case 'decimal':
      return `${serializeIdentifier(attribute.name)}=${attribute.value}`;
    case 'wildcard':
      return `${serializeIdentifier(attribute.name)}=*`;
    case 'identifier-list':
      return `${serializeIdentifier(attribute.name)}=(`
        + `${attribute.values.map((value) => serializeIdentifier(value)).join(', ')})`;
    case 'integer-list':
      return `${serializeIdentifier(attribute.name)}=(`
        + `${attribute.values.join(', ')})`;
    case 'named-arguments':
      return `${serializeIdentifier(attribute.name)}=`
        + `${serializeIdentifier(attribute.value)}(`
        + `${attribute.arguments.map(serializeArgument).join(', ')})`;
    case 'raw':
      return attribute.value;
  }
}

type AttributedDefinition = {
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

// Project formatter for Web IDL §2.5.2 Attributes, §2.5.5 Stringifiers, and §2.5.7 Static attributes and
// operations.
function serializeAttribute<Realm>(
  member: Extract<InterfaceMember<Realm>, { kind: 'attribute'; }>,
): string {
  const modifier = member.stringifier
    ? 'stringifier '
    : member.static
      ? 'static '
      : member.inherit ? 'inherit ' : '';
  const readonly = member.readonly ? 'readonly ' : '';
  return modifier + readonly + `attribute ${serializeType(member.type)} `
    + `${serializeIdentifier(member.name, attributeNameKeywords)};`;
}

// Project formatter for Web IDL §2.5.10 Asynchronously iterable declarations.
function serializeAsyncIterable(member: AsyncIterableMember): string {
  const argumentsList = member.arguments === undefined
    ? ''
    : `(${member.arguments.map(serializeArgument).join(', ')})`;
  return `async_iterable<${serializeOptionalKey(member.key)}`
    + `${serializeType(member.value)}>${argumentsList};`;
}

// Project helper: format an optional key type before an iterable's value type.
function serializeOptionalKey(key: WebIDLType | undefined): string {
  return key === undefined ? '' : `${serializeType(key)}, `;
}

// Project formatter for Web IDL §2.7 Dictionaries — dictionary member syntax.
function serializeDictionaryMember(member: DictionaryMember): string {
  const prefix = serializeInlineAttributes(member);
  const required = member.required ? 'required ' : '';
  const defaultValue = 'default' in member
    ? ` = ${serializeDefaultValue(member.default as DefaultValue)}`
    : '';
  return prefix + required + serializeType(member.type) + ' '
    + serializeIdentifier(member.name) + defaultValue + ';';
}

// Project formatter for Web IDL §2.5.3 Operations — Argument grammar.
function serializeArgument(argument: ArgumentDefinition): string {
  const prefix = serializeInlineAttributes(argument);
  const optional = argument.optional ? 'optional ' : '';
  const variadic = argument.variadic ? '...' : '';
  const defaultValue = 'default' in argument
    ? ` = ${serializeDefaultValue(argument.default as DefaultValue)}`
    : '';
  return prefix + optional + serializeType(argument.type) + variadic + ' '
    + serializeIdentifier(argument.name, argumentNameKeywords) + defaultValue;
}

// Project formatter for Web IDL §2.5.3 Operations — DefaultValue grammar.
function serializeDefaultValue(value: DefaultValue): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return serializeString(value);
  if (value === null) return 'null';

  switch (value.kind) {
    case 'integer':
    case 'decimal':
      return value.value;
    case 'positive-infinity':
      return 'Infinity';
    case 'negative-infinity':
      return '-Infinity';
    case 'not-a-number':
      return 'NaN';
    case 'undefined':
      return 'undefined';
    case 'empty-sequence':
      return '[]';
    case 'empty-dictionary':
      return '{}';
  }
}

// Project formatter for Web IDL §2.5.1 Constants — ConstValue grammar.
function serializeConstantValue(value: ConstantValue): string {
  if (typeof value === 'boolean') return String(value);

  switch (value.kind) {
    case 'integer':
    case 'decimal':
      return value.value;
    case 'positive-infinity':
      return 'Infinity';
    case 'negative-infinity':
      return '-Infinity';
    case 'not-a-number':
      return 'NaN';
  }
}

// Project formatter for Web IDL §2.14 Extended attributes — ExtendedAttributeList grammar.
function serializeAttributes(value: AttributedDefinition): string {
  const attributes = collectAttributes(value);
  return attributes.length === 0 ? '' : `[${attributes.join(', ')}]`;
}

// Project helper: place an extended attribute list before a member or argument.
function serializeInlineAttributes(value: AttributedDefinition): string {
  const attributes = serializeAttributes(value);
  return attributes === '' ? '' : `${attributes} `;
}

// Project helper: combine the exposed field with explicit extended attribute records.
function collectAttributes(value: AttributedDefinition): string[] {
  const attributes: string[] = [];

  if (value.exposed !== undefined) {
    attributes.push(`Exposed=${serializeExposure(value.exposed)}`);
  }
  for (const attribute of value.extendedAttributes ?? []) {
    attributes.push(serializeExtendedAttribute(attribute));
  }
  return attributes;
}

// Project formatter for Web IDL §3.3.7 [Exposed].
function serializeExposure(exposure: Exposure): string {
  if (typeof exposure === 'string') return exposure;
  return `(${exposure.map((value) => serializeIdentifier(value)).join(', ')})`;
}

// Project formatter for the Inheritance grammar in Web IDL §2.2 Interfaces and §2.7 Dictionaries.
function serializeInheritance(inherits: string | undefined): string {
  return inherits === undefined ? '' : ` : ${serializeIdentifier(inherits)}`;
}

// Project helper: format a declaration body with braces, indentation, and a trailing semicolon.
function serializeBlock(header: string, members: string[]): string {
  if (members.length === 0) return `${header} {\n};`;
  return `${header} {\n${members.map((member) => `  ${member}`).join('\n')}\n};`;
}

// Project formatter for Web IDL §2.1 Names — identifier spelling and keyword escaping.
function serializeIdentifier(
  identifier: string,
  permittedKeywords: ReadonlySet<string> = noKeywords,
): string {
  if (!identifierPattern.test(identifier)) {
    throw new TypeError(`Invalid Web IDL identifier: ${identifier}`);
  }
  return reservedIdentifiers.has(identifier) && !permittedKeywords.has(identifier)
    ? `_${identifier}`
    : identifier;
}

// Project formatter for the string token in Web IDL's unnumbered IDL grammar section.
function serializeString(value: string): string {
  if (value.includes('"')) {
    throw new TypeError('Web IDL string values cannot contain U+0022 (").');
  }
  return `"${value}"`;
}

// Web IDL, IDL grammar — terminal keywords take precedence over identifier tokens.
const reservedIdentifiers = new Set([
  'any', 'ArrayBuffer', 'async', 'async_iterable', 'async_sequence', 'attribute',
  'BigInt64Array', 'BigUint64Array', 'bigint', 'boolean', 'byte', 'ByteString',
  'callback', 'const', 'constructor', 'DataView', 'deleter', 'dictionary',
  'DOMString', 'double', 'enum', 'false', 'Float16Array', 'Float32Array',
  'Float64Array', 'float', 'FrozenArray', 'getter', 'includes', 'Infinity',
  'inherit', 'Int8Array', 'Int16Array', 'Int32Array', 'interface', 'iterable',
  'long', 'maplike', 'mixin', 'namespace', 'NaN', 'null', 'object',
  'ObservableArray', 'octet', 'optional', 'or', 'partial', 'Promise', 'readonly',
  'record', 'required', 'sequence', 'setlike', 'setter', 'SharedArrayBuffer',
  'short', 'static', 'stringifier', 'symbol', 'true', 'typedef', 'Uint8Array',
  'Uint8ClampedArray', 'Uint16Array', 'Uint32Array', 'undefined',
  'unrestricted', 'unsigned', 'USVString',
]);

// Web IDL §2.1 Names — ArgumentNameKeyword grammar.
const argumentNameKeywords = new Set([
  'attribute', 'callback', 'const', 'constructor', 'deleter', 'dictionary',
  'enum', 'getter', 'includes', 'inherit', 'interface', 'iterable', 'maplike',
  'mixin', 'namespace', 'partial', 'readonly', 'required', 'setlike', 'setter',
  'static', 'stringifier', 'typedef', 'unrestricted',
]);

// Web IDL §2.5.2 Attributes — AttributeNameKeyword grammar.
const attributeNameKeywords = new Set(['required']);
// Web IDL §2.5.3 Operations — OperationNameKeyword grammar.
const operationNameKeywords = new Set(['includes']);
const noKeywords = new Set<string>();
// Project helper: validate the identifier before adding a keyword escape.
const identifierPattern = /^-?[A-Za-z][0-9A-Z_a-z-]*$/;
