import type {
  ArgumentDefinition, ConstantValue, DefaultValue, Exposure, ExtendedAttribute, ImplementationClass, WebIDLType,
} from './types';
import type { Definition, AsyncIterableMember, InterfaceMember, DictionaryMember } from './declarations';
import { InternalError } from '../../infra/internal-error';

// Project formatter: join definition fragments using the Definitions production (Web IDL, IDL grammar).
export function serializeDefinitions<Env>(
  definitions: Definition<Env>[],
): string {
  const interfaces = collectInterfaceNames(definitions);
  return definitions.map((definition) => serializeDefinition(definition, interfaces)).join('\n\n');
}

// Project formatter for Web IDL §2 Interface definition language — definition syntax.
export function serializeDefinition<Env>(
  definition: Definition<Env>,
  interfaces: InterfaceNames = collectInterfaceNames([definition]),
): string {
  const attributes = serializeAttributes(definition, interfaces);
  const prefix = attributes === '' ? '' : `${attributes}\n`;

  switch (definition.kind) {
    case 'interface':
      return prefix + serializeBlock(
        `interface ${serializeIdentifier(definition.name)}`
        + serializeInheritance(definition.inherits),
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'partial-interface':
      return prefix + serializeBlock(
        `partial interface ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'interface-mixin':
      return prefix + serializeBlock(
        `interface mixin ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'partial-interface-mixin':
      return prefix + serializeBlock(
        `partial interface mixin ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'callback-interface':
      return prefix + serializeBlock(
        `callback interface ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'namespace':
      return prefix + serializeBlock(
        `namespace ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'partial-namespace':
      return prefix + serializeBlock(
        `partial namespace ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeMember(member, interfaces)),
      );
    case 'dictionary':
      return prefix + serializeBlock(
        `dictionary ${serializeIdentifier(definition.name)}`
        + serializeInheritance(definition.inherits),
        definition.members.map((member) => serializeDictionaryMember(member, interfaces)),
      );
    case 'partial-dictionary':
      return prefix + serializeBlock(
        `partial dictionary ${serializeIdentifier(definition.name)}`,
        definition.members.map((member) => serializeDictionaryMember(member, interfaces)),
      );
    case 'enumeration':
      return prefix + `enum ${serializeIdentifier(definition.name)} { `
        + definition.values.map(serializeString).join(', ')
        + ' };';
    case 'callback-function':
      return prefix + `callback ${serializeIdentifier(definition.name)} = `
        + `${serializeType(definition.returns, interfaces)}(`
        + `${definition.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')});`;
    case 'typedef':
      return prefix + `typedef ${serializeType(definition.type, interfaces)} `
        + `${serializeIdentifier(definition.name)};`;
    case 'includes':
      return prefix + `${serializeIdentifier(definition.interface)} includes `
        + `${serializeIdentifier(definition.mixin)};`;
  }
}

// Project formatter for Web IDL §2.5 Members — member syntax.
export function serializeMember<Env>(
  member: InterfaceMember<Env>,
  interfaces?: InterfaceNames,
): string {
  const prefix = serializeInlineAttributes(member, interfaces);

  switch (member.kind) {
    case 'constant':
      return prefix + `const ${serializeType(member.type, interfaces)} `
        + `${serializeIdentifier(member.name)} = `
        + `${serializeConstantValue(member.value)};`;
    case 'attribute':
      return prefix + serializeAttribute(member, interfaces);
    case 'operation': {
      const modifier = member.static
        ? 'static '
        : member.special === undefined ? '' : `${member.special} `;
      const name = member.name === undefined
        ? ''
        : ` ${serializeIdentifier(member.name, operationNameKeywords)}`;
      return prefix + modifier + serializeType(member.returns, interfaces) + name
        + `(${member.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')});`;
    }
    case 'constructor':
      return prefix + `constructor(`
        + `${member.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')});`;
    case 'stringifier':
      return `${prefix}stringifier;`;
    case 'iterable':
      return prefix + `iterable<${serializeOptionalKey(member.key, interfaces)}`
        + `${serializeType(member.value, interfaces)}>;`;
    case 'async-iterable':
      return prefix + serializeAsyncIterable(member, interfaces);
    case 'maplike':
      return prefix + (member.readonly ? 'readonly ' : '')
        + `maplike<${serializeType(member.key, interfaces)}, `
        + `${serializeType(member.value, interfaces)}>;`;
    case 'setlike':
      return prefix + (member.readonly ? 'readonly ' : '')
        + `setlike<${serializeType(member.value, interfaces)}>;`;
  }
}

// Project formatter for Web IDL §2.13 Types — type syntax.
export function serializeType(type: WebIDLType, interfaces?: InterfaceNames): string {
  switch (type.kind) {
    case 'simple':
      return type.name;
    case 'reference':
      return serializeIdentifier(type.name);
    case 'interface': {
      const name = interfaces?.get(type.implClass);
      if (name === undefined) throw new InternalError('No interface declares the referenced implementation class');
      return serializeIdentifier(name);
    }
    case 'nullable':
      return `${serializeType(type.type, interfaces)}?`;
    case 'union':
      return `(${type.types.map((member) => serializeType(member, interfaces)).join(' or ')})`;
    case 'sequence':
      return `sequence<${serializeType(type.type, interfaces)}>`;
    case 'async-sequence':
      return `async_sequence<${serializeType(type.type, interfaces)}>`;
    case 'record':
      return `record<${serializeType(type.key, interfaces)}, ${serializeType(type.value, interfaces)}>`;
    case 'promise':
      return `Promise<${serializeType(type.type, interfaces)}>`;
    case 'frozen-array':
      return `FrozenArray<${serializeType(type.type, interfaces)}>`;
    case 'observable-array':
      return `ObservableArray<${serializeType(type.type, interfaces)}>`;
    case 'annotated':
      return `[${type.extendedAttributes.map((attribute) => serializeExtendedAttribute(attribute, interfaces))
        .join(', ')}] ${serializeType(type.type, interfaces)}`;
  }
}

// Project formatter for Web IDL §2.14 Extended attributes — extended attribute syntax.
export function serializeExtendedAttribute(
  attribute: ExtendedAttribute,
  interfaces?: InterfaceNames,
): string {
  switch (attribute.kind) {
    case 'no-arguments':
      return serializeIdentifier(attribute.name);
    case 'arguments':
      return `${serializeIdentifier(attribute.name)}(`
        + `${attribute.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')})`;
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
        + `${attribute.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')})`;
    case 'raw':
      return attribute.value;
  }
}

type AttributedDefinition = {
  exposed?: Exposure;
  extendedAttributes?: ExtendedAttribute[];
};

type InterfaceNames = ReadonlyMap<ImplementationClass, string>;

function collectInterfaceNames<Env>(definitions: Definition<Env>[]): InterfaceNames {
  const interfaces = new Map<ImplementationClass, string>();
  for (const definition of definitions) {
    if (definition.kind === 'interface' && definition.implementation) {
      interfaces.set(definition.implementation.implClass, definition.name);
    }
  }
  return interfaces;
}

// Project formatter for Web IDL §2.5.2 Attributes, §2.5.5 Stringifiers, and §2.5.7 Static attributes and
// operations.
function serializeAttribute<Env>(
  member: Extract<InterfaceMember<Env>, { kind: 'attribute'; }>,
  interfaces: InterfaceNames | undefined,
): string {
  const modifier = member.stringifier
    ? 'stringifier '
    : member.static
      ? 'static '
      : member.inherit ? 'inherit ' : '';
  const readonly = member.readonly ? 'readonly ' : '';
  return modifier + readonly + `attribute ${serializeType(member.type, interfaces)} `
    + `${serializeIdentifier(member.name, attributeNameKeywords)};`;
}

// Project formatter for Web IDL §2.5.10 Asynchronously iterable declarations.
function serializeAsyncIterable(member: AsyncIterableMember, interfaces: InterfaceNames | undefined): string {
  const argumentsList = member.arguments === undefined
    ? ''
    : `(${member.arguments.map((argument) => serializeArgument(argument, interfaces)).join(', ')})`;
  return `async_iterable<${serializeOptionalKey(member.key, interfaces)}`
    + `${serializeType(member.value, interfaces)}>${argumentsList};`;
}

// Project helper: format an optional key type before an iterable's value type.
function serializeOptionalKey(key: WebIDLType | undefined, interfaces: InterfaceNames | undefined): string {
  return key === undefined ? '' : `${serializeType(key, interfaces)}, `;
}

// Project formatter for Web IDL §2.7 Dictionaries — dictionary member syntax.
function serializeDictionaryMember(member: DictionaryMember, interfaces: InterfaceNames | undefined): string {
  const prefix = serializeInlineAttributes(member, interfaces);
  const required = member.required ? 'required ' : '';
  const defaultValue = 'default' in member
    ? ` = ${serializeDefaultValue(member.default as DefaultValue)}`
    : '';
  return prefix + required + serializeType(member.type, interfaces) + ' '
    + serializeIdentifier(member.name) + defaultValue + ';';
}

// Project formatter for Web IDL §2.5.3 Operations — Argument grammar.
function serializeArgument(argument: ArgumentDefinition, interfaces: InterfaceNames | undefined): string {
  const prefix = serializeInlineAttributes(argument, interfaces);
  const optional = argument.optional ? 'optional ' : '';
  const variadic = argument.variadic ? '...' : '';
  const defaultValue = 'default' in argument
    ? ` = ${serializeDefaultValue(argument.default as DefaultValue)}`
    : '';
  return prefix + optional + serializeType(argument.type, interfaces) + variadic + ' '
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
function serializeAttributes(value: AttributedDefinition, interfaces: InterfaceNames | undefined): string {
  const attributes = collectAttributes(value, interfaces);
  return attributes.length === 0 ? '' : `[${attributes.join(', ')}]`;
}

// Project helper: place an extended attribute list before a member or argument.
function serializeInlineAttributes(value: AttributedDefinition, interfaces: InterfaceNames | undefined): string {
  const attributes = serializeAttributes(value, interfaces);
  return attributes === '' ? '' : `${attributes} `;
}

// Project helper: combine the exposed field with explicit extended attribute records.
function collectAttributes(value: AttributedDefinition, interfaces: InterfaceNames | undefined): string[] {
  const attributes: string[] = [];

  if (value.exposed !== undefined) {
    attributes.push(`Exposed=${serializeExposure(value.exposed)}`);
  }
  for (const attribute of value.extendedAttributes ?? []) {
    attributes.push(serializeExtendedAttribute(attribute, interfaces));
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
    throw new InternalError(`Invalid Web IDL identifier: ${identifier}`);
  }
  return reservedIdentifiers.has(identifier) && !permittedKeywords.has(identifier)
    ? `_${identifier}`
    : identifier;
}

// Project formatter for the string token in Web IDL's unnumbered IDL grammar section.
function serializeString(value: string): string {
  if (value.includes('"')) {
    throw new InternalError('Web IDL string values cannot contain U+0022 (").');
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
