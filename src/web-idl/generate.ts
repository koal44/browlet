import ts from 'typescript';

import { InternalError } from '../infra/index';
import { hasExtendedAttribute, type TypeParameter, type WebIDLType } from './core/index';

import type { WebIDLRealm } from './environment';
import type {
  DefinitionAssembly, AssembledInterface, AssembledArgument,
  AssembledDictionary, AssembledNamespace, IDLType, IDLInterfaceMember, IDLAttribute,
  IDLOperation, IDLIterable, IDLAsyncIterable, IDLMaplike, IDLSetlike, IDLNullableType, IDLUnionType,
} from './assembly/index';
import { matchesExposure } from './assembly/exposure';

/** Options for a module containing platform types, without runtime exports or ambient globals. */
export interface PlatformTypeOptions {
  /** Interface surface forwarded by each declared proxy; recognition hooks cannot describe that shape. */
  proxyInterfaces?: Record<string, string>;
  /** Select one exposure profile; omission describes all declared members and conditional facilities. */
  exposure?: Pick<WebIDLRealm, 'globalNames' | 'secureContext' | 'crossOriginIsolated'>;
}

/**
 * Emit TypeScript declarations from a complete assembly, including any host's common declarations.
 * Inputs describe conventional IDL-shaped author values, rather than every value JavaScript can coerce.
 * TypeScript checks the emitted module without DOM or Node globals, including explicit type refinements.
 * This development entry point does not instantiate bindings, realms, or implementation objects.
 */
export function generatePlatformTypes(assembly: DefinitionAssembly, options: PlatformTypeOptions = {}): string {
  const source = new PlatformTypeGenerator(assembly, options).generate();
  validatePlatformTypes(source);
  return source;
}

class PlatformTypeGenerator {
  /** Completed declaration graph; generation never invokes its implementation hooks. */
  #assembly: DefinitionAssembly;
  /** Explicit proxy surfaces and optional realm exposure selection. */
  #options: PlatformTypeOptions;
  /** Emitted names, including generated companions, share one TypeScript module scope. */
  #names = new Map<string, string>();
  #usedNames = new Set<string>();
  /** Constructor and namespace objects are types, not fabricated exported runtime values. */
  #objects = new Map<object, string>();
  /** Output dictionaries use output container types; defaults belong to input conversion only. */
  #dictionaryOutputs = new Map<AssembledDictionary, string>();
  /** TypeScript refinements recovered from declarations only for this generation run. */
  #typeRefinements = new Map<IDLType, string>();

  constructor(assembly: DefinitionAssembly, options: PlatformTypeOptions) {
    this.#assembly = assembly;
    this.#options = options;
    for (const name of assembly.interfaces.byName.keys()) this.#names.set(name, this.#reserve(name));
    for (const collection of [
      assembly.callbackInterfaces, assembly.callbackFunctions, assembly.dictionaries,
      assembly.enumerations, assembly.typedefs, assembly.proxyObjects, assembly.namespaces,
    ]) {
      for (const name of collection.keys()) this.#names.set(name, this.#reserve(name));
    }
    for (const assembled of assembly.interfaces.values()) {
      if (assembled.hasInterfaceObject()) this.#objects.set(assembled, this.#reserve(`${assembled.name}Constructor`));
    }
    for (const assembled of assembly.callbackInterfaces.withInterfaceObjects()) {
      this.#objects.set(assembled, this.#reserve(`${assembled.primary.name}InterfaceObject`));
    }
    for (const [name, assembled] of assembly.namespaces) this.#objects.set(assembled, this.#name(name));

    // Unused typedef bodies still need types for their generated declarations.
    for (const assembled of assembly.typedefs.values()) assembly.getIDLType(assembled.primary.type);
    for (const [declaration, type] of assembly.typesByDeclaration) this.#collectTypeRefinements(declaration, type);
  }

  generate(): string {
    const blocks = [
      '// Generated from Web IDL declarations. Do not edit by hand.',
      '// Platform types only; importing this module does not install or export runtime objects.',
    ];
    for (const [name, assembled] of this.#assembly.enumerations) {
      blocks.push(`export type ${this.#name(name)} = ${assembled.primary.values.map(quote).join(' | ')};`);
    }
    for (const [name, assembled] of this.#assembly.typedefs) {
      blocks.push(`export type ${this.#name(name)}${this.#typeParameters(assembled.primary.typeParameters)} = ${this.#type(this.#assembly.getIDLType(assembled.primary.type), 'input')};`);
    }
    for (const [name, assembled] of this.#assembly.proxyObjects) {
      const target = this.#options.proxyInterfaces?.[name];
      if (!target || !this.#assembly.interfaces.get(target)) {
        throw new InternalError(`Type generation needs a proxyInterfaces entry naming an interface for ${assembled.primary.name}`);
      }
      blocks.push(`export type ${this.#name(name)} = ${this.#name(target)};`);
    }
    for (const assembled of this.#assembly.dictionaries.values()) {
      blocks.push(this.#dictionary(assembled, 'input', this.#name(assembled.primary.name)));
    }
    for (const [name, assembled] of this.#assembly.callbackFunctions) {
      blocks.push(`export type ${this.#name(name)}${this.#typeParameters(assembled.primary.typeParameters)} = (${this.#arguments(assembled.arguments, 'output')}) => ${this.#result(assembled.returns, 'input')};`);
    }
    for (const [name, assembled] of this.#assembly.callbackInterfaces) {
      const operations = assembled.members.filter((member): member is IDLOperation => member.kind === 'operation');
      const members = operations.map((member) => `${propertyName(member.name!)}${this.#signature(member, true)};`);
      const nameWithParameters = this.#name(name) + this.#typeParameters(assembled.primary.typeParameters);
      // Web IDL permits a callable object for a single-operation callback interface.
      if (operations.length === 1) {
        const operation = operations[0]!;
        blocks.push(`export type ${nameWithParameters} = {\n${indent(members)}\n} | (${this.#typeParameters(operation.typeParameters)}(${this.#arguments(operation.arguments, 'output')}) => ${this.#result(operation.returns, 'input')});`);
      } else {
        blocks.push(this.#interface(nameWithParameters, members));
      }
      const objectName = this.#objects.get(assembled);
      if (objectName) {
        blocks.push(this.#interface(objectName, assembled.members.flatMap((member) =>
          member.kind === 'constant' && this.#exposed(member) ? this.#member(member) : [])));
      }
    }
    for (const assembled of this.#assembly.interfaces.values()) {
      blocks.push(...this.#platformInterface(assembled));
    }
    for (const assembled of this.#assembly.namespaces.values()) {
      blocks.push(this.#namespace(assembled));
    }
    // Rendering a dictionary can discover another output dictionary, including recursive ones.
    for (const [assembled, name] of this.#dictionaryOutputs) {
      blocks.push(this.#dictionary(assembled, 'output', name));
    }
    return blocks.join('\n\n') + '\n';
  }

  #platformInterface(assembled: AssembledInterface): string[] {
    const name = this.#name(assembled.name);
    const parameters = assembled.primary.typeParameters;
    const members: string[] = [];
    const ownNames = new Set<string>();
    let collection: IDLIterable | IDLAsyncIterable | IDLMaplike | IDLSetlike | undefined;
    for (const entry of assembled.members) {
      if (!this.#exposed(assembled.primary) || !this.#exposed(entry.source) || !this.#exposed(entry.member)) continue;
      const member = entry.member;
      if ('static' in member && member.static) continue;
      if (member.kind === 'constructor') continue;
      if (member.kind === 'iterable' || member.kind === 'async-iterable' || member.kind === 'maplike' || member.kind === 'setlike') {
        collection = member;
        continue;
      }
      if ('name' in member && member.name) ownNames.add(member.name);
      members.push(...this.#member(member));
    }
    // A derived setter can make an inherited indexed getter writable.
    let indexedGetter: IDLOperation | undefined;
    let indexedSetter: IDLOperation | undefined;
    for (const ancestor of assembled.getInheritanceChain()) {
      for (const entry of ancestor.members) {
        const member = entry.member;
        if (!this.#exposed(ancestor.primary) || !this.#exposed(entry.source) || !this.#exposed(member)) continue;
        if (member.kind !== 'operation' || member.arguments[0]?.type.kind !== 'integer') continue;
        if (member.special === 'getter') indexedGetter = member;
        if (member.special === 'setter') indexedSetter = member;
      }
    }
    if (indexedGetter) {
      members.push(`${indexedSetter ? '' : 'readonly '}[index: number]: ${this.#type(indexedGetter.returns, 'output')} | undefined;`);
      if (!collection) members.push(`[Symbol.iterator](): IterableIterator<${this.#type(indexedGetter.returns, 'output')}>;`);
    }
    if (collection) members.push(...this.#collection(collection, ownNames));
    if (assembled.isGlobal()) members.push(...this.#globals(assembled));
    const parent = assembled.parentAssembled;
    const blocks = [this.#interface(name + this.#typeParameters(parameters), members, parent && this.#name(parent.name))];
    const objectName = this.#objects.get(assembled);
    if (objectName) {
      // The constructor object is shared by every instantiation; only construction infers type arguments.
      const instance = name + typeArguments(parameters, true);
      const objectMembers = [`readonly prototype: ${instance};`, `[Symbol.hasInstance](value: unknown): value is ${instance};`];
      for (const entry of assembled.members) {
        const member = entry.member;
        if (!this.#exposed(assembled.primary) || !this.#exposed(entry.source) || !this.#exposed(member)) continue;
        if (member.kind === 'constructor') {
          const constructorParameters = member.typeParameters ? (parameters ?? []).concat(member.typeParameters) : parameters;
          objectMembers.push(`new ${this.#typeParameters(constructorParameters)}(${this.#arguments(member.arguments, 'input')}): ${name}${typeArguments(parameters)};`);
        }
      }
      // Interface objects inherit static members, but never inherit constructor signatures.
      const staticMembers = new Map<string, string[]>();
      for (const ancestor of assembled.getInheritanceChain()) {
        const own = new Map<string, string[]>();
        for (const entry of ancestor.members) {
          const member = entry.member;
          if (!this.#exposed(entry.source) || !this.#exposed(member)) continue;
          if (member.kind !== 'constant' && !('static' in member && member.static)) continue;
          if (!('name' in member) || !member.name) continue;
          const lines = own.get(member.name) ?? [];
          lines.push(...this.#member(member));
          own.set(member.name, lines);
        }
        for (const [key, lines] of own) staticMembers.set(key, lines);
      }
      for (const lines of staticMembers.values()) objectMembers.push(...lines);
      blocks.push(this.#interface(objectName, objectMembers));
    }
    return blocks;
  }

  #member(member: IDLInterfaceMember): string[] {
    switch (member.kind) {
      case 'constant': {
        const value = member.value;
        let type = this.#type(member.type, 'output');
        if (typeof value === 'boolean') {
          type = String(value);
        } else if (value.kind === 'integer') {
          const integer = this.#assembly.getIntegerLiteralValue(value);
          type = member.type.kind === 'bigint' ? `${integer}n` : String(Number(integer));
        } else if (value.kind === 'decimal') {
          const number = member.type.kind === 'float' &&
            (member.type.name === 'float' || member.type.name === 'unrestricted float')
            ? Math.fround(Number(value.value)) : Number(value.value);
          if (Number.isFinite(number)) type = String(number);
        }
        return [`readonly ${propertyName(member.name)}: ${type};`];
      }
      case 'attribute': {
        const output = this.#type(member.type, 'output');
        const input = this.#attributeInput(member);
        const name = propertyName(member.name);
        const lines = input === undefined ? [`readonly ${name}: ${output};`]
          : input === output ? [`${name}: ${output};`]
            : [`get ${name}(): ${output};`, `set ${name}(value: ${input});`];
        if (member.type.kind === 'object' && hasExtendedAttribute(member.extendedAttributes, 'PutForwards')) {
          lines.unshift('/** The declaration leaves the forwarded property opaque; its assignment type is unknown. */');
        }
        if (member.stringifier) lines.push('toString(): string;');
        return lines;
      }
      case 'operation': {
        const lines = member.name ? [`${propertyName(member.name)}${this.#signature(member)};`] : [];
        // Named property getters cannot have a precise string index signature alongside methods.
        return lines;
      }
      case 'stringifier': return ['toString(): string;'];
      default: return [];
    }
  }

  #attributeInput(member: IDLAttribute, seen = new Set<IDLAttribute>()): string | undefined {
    if (seen.has(member)) throw new InternalError(`Cyclic PutForwards attribute: ${member.name}`);
    seen.add(member);
    if (hasExtendedAttribute(member.extendedAttributes, 'Replaceable') ||
      hasExtendedAttribute(member.extendedAttributes, 'LegacyLenientSetter')) return 'unknown';
    const forwards = member.extendedAttributes?.find((attribute) => attribute.kind === 'identifier' && attribute.name === 'PutForwards');
    if (forwards?.kind === 'identifier') {
      // Some unfinished integrations deliberately declare their exposed object as opaque.
      // Its forwarded property's type is unavailable, just like any other property of `object`.
      if (member.type.kind === 'object') return 'unknown';
      if (member.type.kind !== 'interface') throw new InternalError(`PutForwards needs an interface: ${member.name}`);
      for (const ancestor of member.type.assembled.getInheritanceChain().toReversed()) {
        for (const entry of ancestor.members) {
          if (entry.member.kind === 'attribute' && entry.member.name === forwards.value) {
            return this.#attributeInput(entry.member, seen);
          }
        }
      }
      throw new InternalError(`Unknown PutForwards attribute: ${forwards.value}`);
    }
    return member.readonly ? undefined : this.#type(member.type, 'input');
  }

  #collection(member: IDLIterable | IDLAsyncIterable | IDLMaplike | IDLSetlike, declared: Set<string>): string[] {
    const value = this.#type(member.value, 'output');
    const key = member.kind === 'setlike' ? value : member.key ? this.#type(member.key, 'output') : 'number';
    const async = member.kind === 'async-iterable';
    const iterator = async ? 'AsyncIterableIterator' : 'IterableIterator';
    const args = async ? this.#arguments(member.arguments, 'input') : '';
    const pair = member.kind === 'maplike' || ('key' in member && member.key !== undefined);
    const entries = new Map<string, string>([
      [async ? '[Symbol.asyncIterator]' : '[Symbol.iterator]', `(${args}): ${iterator}<${pair ? `[${key}, ${value}]` : value}>;`],
      ['values', `(${args}): ${iterator}<${value}>;`],
    ]);
    if (!async || pair) {
      entries.set('keys', `(${args}): ${iterator}<${key}>;`);
      entries.set('entries', `(${args}): ${iterator}<[${key}, ${value}]>;`);
    }
    if (!async) entries.set('forEach', `(callback: (value: ${value}, key: ${key}, parent: this) => void, thisArg?: unknown): void;`);
    if (member.kind === 'maplike' || member.kind === 'setlike') {
      const input = this.#type(member.value, 'input');
      const keyInput = member.kind === 'maplike' ? this.#type(member.key, 'input') : input;
      entries.set('size', ': number;');
      entries.set('has', `(key: ${keyInput}): boolean;`);
      if (member.kind === 'maplike') entries.set('get', `(key: ${keyInput}): ${value} | undefined;`);
      if (!member.readonly) {
        entries.set('clear', '(): void;');
        entries.set('delete', `(key: ${keyInput}): boolean;`);
        if (member.kind === 'maplike') entries.set('set', `(key: ${keyInput}, value: ${input}): this;`);
        else entries.set('add', `(value: ${input}): this;`);
      }
    }
    const members: string[] = [];
    for (const [name, signature] of entries) {
      if (!declared.has(name)) members.push(`${name === 'size' ? 'readonly ' : ''}${name}${signature}`);
    }
    return members;
  }

  #namespace(assembled: AssembledNamespace): string {
    const members: string[] = [];
    for (const entry of assembled.members) {
      if (this.#exposed(assembled.primary) && this.#exposed(entry.source) && this.#exposed(entry.member)) {
        members.push(...this.#member(entry.member));
      }
    }
    for (const child of this.#assembly.interfaces.inNamespace(assembled.primary.name)) {
      if (this.#exposed(child.primary) && child.hasInterfaceObject()) {
        members.push(`${propertyName(child.name)}: ${this.#objects.get(child)!};`);
      }
    }
    return this.#interface(this.#name(assembled.primary.name), members);
  }

  #globals(global: AssembledInterface): string[] {
    const globalNames = new Set<string>();
    for (const attribute of global.primary.extendedAttributes ?? []) {
      if (attribute.kind === 'identifier' && attribute.name === 'Global') globalNames.add(attribute.value);
      if (attribute.kind === 'identifier-list' && attribute.name === 'Global') {
        for (const name of attribute.values) globalNames.add(name);
      }
    }
    const profile = this.#options.exposure ?? { globalNames, secureContext: true, crossOriginIsolated: true };
    const members: string[] = [];
    for (const assembled of this.#assembly.interfaces.values()) {
      if (!matchesExposure(assembled.primary, profile)) continue;
      const objectName = this.#objects.get(assembled);
      if (objectName && !assembled.getLegacyNamespace()) {
        members.push(`${propertyName(assembled.name)}: ${objectName};`);
        if (globalNames.has('Window')) {
          for (const alias of assembled.getLegacyWindowAliases()) members.push(`${propertyName(alias)}: ${objectName};`);
        }
      }
      for (const name of assembled.getLegacyFactoryNames()) {
        const signatures = assembled.getLegacyFactoryOverloads(name).callables.map((callable) =>
          `new (${this.#arguments(callable.arguments, 'input')}): ${this.#name(assembled.name)};`);
        members.push(`${propertyName(name)}: { ${signatures.join(' ')} };`);
      }
    }
    for (const assembled of this.#assembly.callbackInterfaces.withInterfaceObjects()) {
      if (matchesExposure(assembled.primary, profile)) members.push(`${propertyName(assembled.primary.name)}: ${this.#objects.get(assembled)!};`);
    }
    for (const assembled of this.#assembly.namespaces.values()) {
      if (matchesExposure(assembled.primary, profile)) members.push(`${propertyName(assembled.primary.name)}: ${this.#objects.get(assembled)!};`);
    }
    return members;
  }

  #dictionary(assembled: AssembledDictionary, direction: Direction, name: string): string {
    const members = assembled.members.map((member) => {
      return `${propertyName(member.name)}${member.required ? '' : '?'}: ${this.#type(member.type, direction)};`;
    });
    return this.#interface(name + this.#typeParameters(assembled.primary.typeParameters), members);
  }

  #type(type: IDLType, direction: Direction): string {
    const refinement = this.#typeRefinements.get(type);
    if (refinement !== undefined) return typeExpression(refinement);
    switch (type.kind) {
      case 'any': case 'undefined': case 'boolean': case 'bigint': case 'object': case 'symbol': return type.kind;
      case 'integer': case 'float': return 'number';
      case 'string': return 'string';
      case 'buffer-source': {
        if (type.name === 'ArrayBuffer') return type.allowShared ? '(ArrayBuffer | SharedArrayBuffer)' : 'ArrayBuffer';
        if (type.name === 'SharedArrayBuffer') return 'SharedArrayBuffer';
        return `${type.name}<${type.allowShared ? 'ArrayBufferLike' : 'ArrayBuffer'}>`;
      }
      case 'nullable': return `(${this.#type(type.innerType, direction)} | null)`;
      case 'union': return `(${type.memberTypes.map((member) => this.#type(member, direction)).join(' | ')})`;
      case 'sequence': return `${direction === 'input' ? 'Iterable' : 'Array'}<${this.#type(type.elementType, direction)}>`;
      case 'async-sequence': {
        const element = this.#type(type.elementType, direction);
        // Output returns the captured object, which can still be a synchronous iterable.
        return `(AsyncIterable<${element}> | Iterable<${element}>)`;
      }
      case 'frozen-array': return `${direction === 'input' ? 'Iterable' : 'ReadonlyArray'}<${this.#type(type.elementType, direction)}>`;
      case 'observable-array': return `Array<${this.#type(type.elementType, direction)}>`;
      case 'record': return `Record<string, ${this.#type(type.valueType, direction)}>`;
      case 'promise': {
        const value = this.#result(type.resultType, direction);
        return direction === 'input' ? `(${value} | PromiseLike<${value}>)` : `Promise<${value}>`;
      }
      case 'dictionary': {
        if (direction === 'input') return this.#name(type.assembled.primary.name);
        let name = this.#dictionaryOutputs.get(type.assembled);
        if (!name) {
          name = this.#reserve(`${type.assembled.primary.name}Result`);
          this.#dictionaryOutputs.set(type.assembled, name);
        }
        return name;
      }
      case 'interface': case 'enumeration': case 'callback-function': case 'callback-interface': case 'proxy-object':
        return this.#name(type.assembled.primary.name);
    }
  }

  #signature(callable: IDLOperation, callback = false): string {
    return `${this.#typeParameters(callable.typeParameters)}(${this.#arguments(callable.arguments, callback ? 'output' : 'input')}): ${this.#result(callable.returns, callback ? 'input' : 'output')}`;
  }

  #arguments(args: AssembledArgument[], direction: Direction): string {
    const names = new Set<string>();
    return args.map((argument, index) => {
      const base = identifier(argument.name);
      const name = names.has(base) ? `${base}_${index}` : base;
      names.add(name);
      const type = this.#type(argument.type, direction);
      if (argument.optionality === 'variadic') return `...${name}: Array<${type}>`;
      const optional = argument.optionality === 'optional';
      const requiredAfter = args.slice(index + 1).some((item) => item.optionality === 'required');
      return `${name}${optional && !requiredAfter ? '?' : ''}: ${type}${optional && requiredAfter ? ' | undefined' : ''}`;
    }).join(', ');
  }

  #result(type: IDLType, direction: Direction): string {
    return type.kind === 'undefined' && !this.#typeRefinements.has(type) ? 'void' : this.#type(type, direction);
  }

  #collectTypeRefinements(declaration: WebIDLType, type: IDLType): void {
    while (true) {
      if (declaration.typescript !== undefined) {
        this.#typeRefinements.set(type, declaration.typescript);
        return;
      }
      if (declaration.kind === 'annotated') {
        declaration = declaration.type;
        continue;
      }
      if (declaration.kind === 'reference') {
        const assembled = this.#assembly.typedefs.get(declaration.name);
        if (assembled) {
          // Generic aliases retain their own parameter scope in generated declarations.
          if (assembled.primary.typeParameters?.length) {
            this.#typeRefinements.set(type, this.#name(assembled.primary.name));
            return;
          }
          declaration = assembled.primary.type;
          continue;
        }
      }
      break;
    }

    // Nullable and union types pass attributes to their children, which can then
    // have separate compiled contracts outside the declaration cache.
    if (declaration.kind === 'nullable') {
      this.#collectTypeRefinements(declaration.type, (type as IDLNullableType).innerType);
    } else if (declaration.kind === 'union') {
      const members = (type as IDLUnionType).memberTypes;
      declaration.types.forEach((member, index) => this.#collectTypeRefinements(member, members[index]!));
    }
  }

  #typeParameters(parameters: TypeParameter[] | undefined): string {
    if (!parameters?.length) return '';
    return `<${parameters.map((parameter) => {
      if (identifier(parameter.name) !== parameter.name) {
        throw new InternalError(`Invalid TypeScript type parameter name: ${parameter.name}`);
      }
      const constraint = parameter.extends === undefined ? '' : ` extends ${typeExpression(parameter.extends)}`;
      const fallback = parameter.default === undefined ? '' : ` = ${typeExpression(parameter.default)}`;
      return parameter.name + constraint + fallback;
    }).join(', ')}>`;
  }

  #exposed(construct: Parameters<typeof matchesExposure>[0]): boolean {
    return !this.#options.exposure || matchesExposure(construct, this.#options.exposure);
  }

  #interface(name: string, members: string[], parent?: string): string {
    return `export interface ${name}${parent ? ` extends ${parent}` : ''} {\n${indent(members)}\n}`;
  }

  #name(name: string): string {
    const result = this.#names.get(name);
    if (!result) throw new InternalError(`Undeclared platform type: ${name}`);
    return result;
  }

  #reserve(name: string): string {
    const base = identifier(name);
    let result = base;
    let suffix = 2;
    while (this.#usedNames.has(result)) result = `${base}_${suffix++}`;
    this.#usedNames.add(result);
    return result;
  }
}

type Direction = 'input' | 'output';

function typeArguments(parameters: TypeParameter[] | undefined, erase = false): string {
  return parameters?.length ? `<${parameters.map((parameter) => erase ? 'any' : parameter.name).join(', ')}>` : '';
}

/** Accept a single TypeScript type expression, preserving precedence when inserted into a larger type. */
function typeExpression(expression: string): string {
  const source = ts.createSourceFile('type.ts', `type Type = ${expression};`, ts.ScriptTarget.Latest, true);
  const declaration = source.statements[0];
  if (source.statements.length !== 1 || !declaration || !ts.isTypeAliasDeclaration(declaration) ||
    declaration.type.getText(source) !== expression.trim()) {
    throw new InternalError(`Expected a TypeScript type expression: ${expression}`);
  }
  const type = declaration.type;
  return ts.isConditionalTypeNode(type) || ts.isFunctionTypeNode(type) || ts.isConstructorTypeNode(type)
    ? `(${expression})` : expression;
}

/** Use the compiler to check names, generic scopes, constraints, and the complete generated surface. */
function validatePlatformTypes(source: string): void {
  const fileName = '__web_idl_platform__.d.ts';
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: false,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.esnext.d.ts'], types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, onError, shouldCreateNewSourceFile) =>
    file === fileName ? ts.createSourceFile(file, source, version, true)
      : getSourceFile(file, version, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fileName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new InternalError('Invalid generated platform declarations:\n' + diagnostics.map((diagnostic) => {
      const position = diagnostic.file?.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const location = position ? `${position.line + 1}:${position.character + 1}: ` : '';
      return location + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    }).join('\n'));
  }
}

const reservedIdentifiers = new Set((
  'any arguments await bigint boolean break case catch class const continue debugger default delete do else enum ' +
  'eval export extends false finally for function if implements import in instanceof interface let new null number ' +
  'object package private protected public return static string super switch symbol this throw true try typeof ' +
  'undefined var void while with yield'
).split(' '));

function identifier(name: string): string {
  let result = name.replace(/[^a-zA-Z0-9_$]/g, '_');
  if (!/^[a-zA-Z_$]/.test(result)) result = `_${result}`;
  return reservedIdentifiers.has(result) ? `${result}_` : result;
}

function propertyName(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : quote(name);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function indent(lines: string[]): string {
  return lines.map((line) => `  ${line}`).join('\n');
}
