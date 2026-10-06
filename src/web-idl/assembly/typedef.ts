import type { TypedefDefinition, Definition, ExtendedAttribute, WebIDLType } from '../core/index';

/** A named type alias followed during type resolution. */
export class AssembledTypedef {
  /** Original alias declaration and its referenced type. */
  primary: TypedefDefinition;

  constructor(primary: TypedefDefinition) {
    this.primary = primary;
  }
}

/** Resolve alias chains without deciding how a caller uses the resulting type. */
export class AssembledTypedefs extends Map<string, AssembledTypedef> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'typedef') this.set(definition.name, new AssembledTypedef(definition));
    }
  }

  /** Strip aliases and annotations, optionally collecting conversion attributes. */
  resolve(type: WebIDLType, collectedAttributes?: ExtendedAttribute[]): Exclude<WebIDLType, { kind: 'annotated'; }> {
    while (true) {
      if (type.kind === 'annotated') {
        if (collectedAttributes) {
          for (const attribute of type.extendedAttributes) collectedAttributes.push(attribute);
        }
        type = type.type;
        continue;
      }
      if (type.kind === 'reference') {
        const assembled = this.get(type.name);
        if (assembled) {
          type = assembled.primary.type;
          continue;
        }
      }
      return type;
    }
  }
}
