import { InternalError } from '../../infra/index';
import type { Definition, DictionaryDefinition, PrimaryInterfaceDefinition, WebIDLType } from '../core/index';

import { assembleMember } from './member';
import { DefinitionAssembly } from './assembly';

/**
 * Check a complete declaration set during development or tests; normal assembly trusts its inputs.
 * Checks composition, cycles, serialization markers, and type references, including unused aliases and mixins.
 */
export function validateDefinitions<Env>(definitions: Definition<Env>[]): void {
  // Validation inspects declarations without invoking their environment-specific binding hooks.
  const declarations = definitions as Definition[];
  const definitionsByName = new Map<string, Definition>();
  for (const definition of declarations) {
    switch (definition.kind) {
      case 'includes': case 'partial-interface': case 'partial-interface-mixin':
      case 'partial-dictionary': case 'partial-namespace': continue;
    }
    if (definitionsByName.has(definition.name)) {
      throw new InternalError(`Duplicate Web IDL definition ${definition.name}`);
    }
    definitionsByName.set(definition.name, definition);
  }

  const includedMixins = new Map<string, Set<string>>();
  for (const definition of declarations) {
    switch (definition.kind) {
      case 'partial-interface': case 'partial-interface-mixin':
      case 'partial-dictionary': case 'partial-namespace': {
        const kind = definition.kind.slice('partial-'.length);
        if (definitionsByName.get(definition.name)?.kind !== kind) {
          throw new InternalError(`Partial ${kind} ${definition.name} has no primary ${kind}`);
        }
        break;
      }
      case 'includes': {
        const name = definition.interface;
        if (definitionsByName.get(name)?.kind !== 'interface') {
          throw new InternalError(`Includes target ${name} is not an interface`);
        }
        if (definitionsByName.get(definition.mixin)?.kind !== 'interface-mixin') {
          throw new InternalError(`Includes source ${definition.mixin} is not a mixin`);
        }
        let included = includedMixins.get(name);
        if (!included) includedMixins.set(name, included = new Set());
        if (included.has(definition.mixin)) {
          throw new InternalError(`Duplicate includes statement: ${name} includes ${definition.mixin}`);
        }
        included.add(definition.mixin);
        break;
      }
      case 'interface':
        // https://html.spec.whatwg.org/multipage/structured-data.html#serializable-objects
        // https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects
        // Steps require exactly one marker; a marker alone can describe unfinished support.
        for (const [name, steps] of [
          ['Serializable', definition.serialSteps],
          ['Transferable', definition.transferSteps],
        ] as const) {
          const markers = definition.extendedAttributes?.filter(
            (attribute) => attribute.kind !== 'raw' && attribute.name === name,
          ) ?? [];
          if (markers.length === 0 && !steps) continue;
          if (markers.length !== 1 || markers[0]?.kind !== 'no-arguments') {
            throw new InternalError(`${definition.name} must declare exactly one [${name}] marker`);
          }
        }
    }
  }

  validateInheritance(definitionsByName);
  const visited = new Set<WebIDLType>();
  const visiting = new Set<WebIDLType>();
  for (const definition of definitionsByName.values()) {
    if (definition.kind === 'typedef') validateTypedef(definition.type, definitionsByName, visited, visiting);
  }

  // Reuse compilation for type checks after structural validation has ruled out cycles.
  const assembly = new DefinitionAssembly(declarations);
  for (const definition of declarations) {
    if (definition.kind === 'typedef') assembly.getNamedType(definition.name);
    if (definition.kind === 'interface-mixin' || definition.kind === 'partial-interface-mixin') {
      for (const member of definition.members) assembleMember(member, assembly);
    }
  }
}

// Visit each ancestry once; only an unfinished path can contain an inheritance cycle.
function validateInheritance(definitionsByName: Map<string, Definition>): void {
  const visited = new Set<PrimaryInterfaceDefinition | DictionaryDefinition>();
  const visiting = new Set<PrimaryInterfaceDefinition | DictionaryDefinition>();
  for (const definition of definitionsByName.values()) {
    if (definition.kind !== 'interface' && definition.kind !== 'dictionary') continue;
    let current = definition;
    while (!visited.has(current)) {
      if (visiting.has(current)) throw new InternalError(`Inheritance cycle involving ${current.name}`);
      visiting.add(current);
      if (!current.inherits) break;
      const parent = definitionsByName.get(current.inherits);
      if (
        (parent?.kind !== 'interface' && parent?.kind !== 'dictionary') ||
        parent.kind !== current.kind
      ) throw new InternalError(`${current.kind} ${current.name} inherits unknown ${current.kind} ${current.inherits}`);
      current = parent;
    }
    for (const current of visiting) visited.add(current);
    visiting.clear();
  }
}

// Expanding an alias must terminate, including aliases nested in containers.
// Named interfaces and dictionaries end expansion, so recursive value shapes remain valid.
function validateTypedef(
  type: WebIDLType, definitionsByName: Map<string, Definition>,
  visited: Set<WebIDLType>, visiting: Set<WebIDLType>,
): void {
  if (visited.has(type)) return;
  if (visiting.has(type)) throw new InternalError('Typedef expansion contains a cycle');
  visiting.add(type);
  switch (type.kind) {
    case 'reference': {
      const definition = definitionsByName.get(type.name);
      if (definition?.kind === 'typedef') validateTypedef(definition.type, definitionsByName, visited, visiting);
      break;
    }
    case 'annotated': case 'nullable': case 'sequence': case 'async-sequence':
    case 'frozen-array': case 'observable-array': case 'promise':
      validateTypedef(type.type, definitionsByName, visited, visiting);
      break;
    case 'union':
      for (const member of type.types) validateTypedef(member, definitionsByName, visited, visiting);
      break;
    case 'record':
      validateTypedef(type.key, definitionsByName, visited, visiting);
      validateTypedef(type.value, definitionsByName, visited, visiting);
      break;
  }
  visiting.delete(type);
  visited.add(type);
}
