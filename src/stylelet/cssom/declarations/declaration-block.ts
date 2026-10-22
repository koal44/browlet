import { parseDeclarationList, serializeCssIdentifier, type ParserInput } from '../../syntax/index';
import {
  getShorthands, interpretPropertyDeclarations, propertyRegistry, serializePropertyDeclaration,
  type BuiltInPropertyDeclaration, type PropertyDeclaration, type PropertyContext, type ShorthandRecord,
} from '../../props/index';

/** Parsed declarations shared by style resolution and a separately created CSSOM object. */
// https://drafts.csswg.org/cssom/#css-declaration-blocks
// This collection owns ordering and mutation, not the associated CSSOM flags,
// owner, or Platform identity. Inline style can retain it before .style is read.
export class CSSDeclarationBlock {
  /** Winning declaration for each property, retaining the block's property order. */
  #declarations: PropertyDeclaration[] = [];

  /** Collect the initial declarations with source-order and importance handling. */
  constructor(declarations: readonly PropertyDeclaration[] = []) {
    this.#replace(declarations);
  }

  /** Read declarations without bypassing replacement and importance handling. */
  get declarations(): readonly PropertyDeclaration[] {
    return this.#declarations;
  }

  /** Serialize the retained declarations at their current value stage. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-declaration-block
  get cssText(): string {
    const serialized: string[] = [];
    const alreadySerialized = new Set<string>();
    declarations: for (const declaration of this.#declarations) {
      if (alreadySerialized.has(declaration.name)) continue;
      if (!declaration.custom) {
        for (const [name, shorthand] of getShorthands(declaration.name)) {
          const longhands = this.getLonghands(shorthand);
          if (longhands === null || longhands.some(({ name }) => alreadySerialized.has(name))) continue;
          if (this.#hasInterleavedLogicalGroup(longhands)) continue;
          const value = shorthand.serialize(longhands);
          if (value === '') continue;
          serialized.push(serializeDeclaration(name, value, declaration.important));
          for (const longhand of longhands) alreadySerialized.add(longhand.name);
          continue declarations;
        }
      }
      const { name, value, important } = serializePropertyDeclaration(declaration);
      serialized.push(serializeDeclaration(name, value, important));
      alreadySerialized.add(name);
    }
    return serialized.join(' ');
  }

  /** Replace the block with parsed attribute or CSSOM text. */
  setText(value: string, context: PropertyContext): void {
    this.#replace(parseDeclarationBlock(value, context));
  }

  /** Remove all declarations while preserving the block's identity. */
  clear(): void {
    this.#declarations = [];
  }

  /** Find a declaration by its normalized property name. */
  find(name: string): PropertyDeclaration | undefined {
    return this.#declarations.find((declaration) => declaration.name === name);
  }

  /** Return complete, equally important shorthand longhands in canonical order, or null. */
  getLonghands(shorthand: ShorthandRecord): BuiltInPropertyDeclaration[] | null {
    const longhands: BuiltInPropertyDeclaration[] = [];
    for (const name of shorthand.longhands) {
      const declaration = this.find(name);
      if (declaration === undefined || declaration.custom) return null;
      if (longhands.length > 0 && declaration.important !== longhands[0]!.important) return null;
      longhands.push(declaration);
    }
    return longhands;
  }

  /** Set a declaration, retaining its position unless an opposite logical mapping follows it. */
  // https://drafts.csswg.org/cssom/#set-a-css-declaration
  set(declaration: PropertyDeclaration): boolean {
    const index = this.#declarations.findIndex(({ name }) => name === declaration.name);
    if (index < 0) {
      this.#declarations.push(declaration);
      return true;
    }

    for (let i = index + 1; i < this.#declarations.length; i++) {
      if (hasDifferentMapping(declaration, this.#declarations[i]!)) {
        this.#declarations.splice(index, 1);
        this.#declarations.push(declaration);
        return true;
      }
    }

    const previous = this.#declarations[index]!;
    const previousValue = serializePropertyDeclaration(previous).value;
    const nextValue = serializePropertyDeclaration(declaration).value;
    if (previous.important === declaration.important && previousValue === nextValue) return false;

    this.#declarations[index] = declaration;
    return true;
  }

  /** Remove a declaration by its normalized property name. */
  remove(name: string): boolean {
    const index = this.#declarations.findIndex((declaration) => declaration.name === name);
    if (index < 0) return false;
    this.#declarations.splice(index, 1);
    return true;
  }

  /** Whether combining these longhands would reorder an intervening opposite logical mapping. */
  #hasInterleavedLogicalGroup(longhands: BuiltInPropertyDeclaration[]): boolean {
    const indices = longhands.map((declaration) => this.#declarations.indexOf(declaration));
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    for (let i = first + 1; i < last; i++) {
      const declaration = this.#declarations[i]!;
      if (longhands.some((longhand) => longhand === declaration)) continue;
      if (longhands.some((longhand) => hasDifferentMapping(longhand, declaration))) return true;
    }
    return false;
  }

  /** Keep each winning declaration at its specified position, rather than its first occurrence. */
  // https://drafts.csswg.org/cssom/#concept-declarations-specified-order
  // SPEC_CLASH(important-declaration-order): Follow CSSOM/Firefox's winning position;
  // Chromium/WebKit move an earlier important winner to a later losing declaration's position.
  #replace(declarations: readonly PropertyDeclaration[]): void {
    const winners = new Map<string, PropertyDeclaration>();
    for (const declaration of declarations) {
      const previous = winners.get(declaration.name);
      if (previous?.important && !declaration.important) continue;
      winners.delete(declaration.name);
      winners.set(declaration.name, declaration);
    }
    this.#declarations = [...winners.values()];
  }
}

/** Parse supported property declarations without interpreting nested style rules. */
// https://drafts.csswg.org/cssom/#parse-a-css-declaration-block
// TODO: retain per-declaration parse-time URL bases when URL-valued properties are registered.
export function parseDeclarationBlock(input: ParserInput, context: PropertyContext): PropertyDeclaration[] {
  return interpretPropertyDeclarations(parseDeclarationList(input, context), context);
}

/** Serialize a name, an already serialized value, and its priority. */
// https://drafts.csswg.org/cssom/#serialize-a-css-declaration
function serializeDeclaration(name: string, value: string, important: boolean): string {
  // SPEC_CLASH(custom-property-name-serialization): Follow Chromium/Firefox by
  // escaping decoded custom names; CSSOM's literal steps and WebKit emit them raw.
  const property = name.startsWith('--') ? serializeCssIdentifier(name) : name;
  const text = /[^\t\n\f\r ]/.test(value) ? value : '';
  return `${property}: ${text}${important ? ' !important' : ''};`;
}

/** Whether two properties belong to one logical group but map its sides differently. */
// https://drafts.csswg.org/css-logical-1/#logical-property-group
function hasDifferentMapping(a: PropertyDeclaration, b: PropertyDeclaration): boolean {
  if (a.custom || b.custom) return false;
  const left = propertyRegistry[a.name].logicalGroup;
  const right = propertyRegistry[b.name].logicalGroup;
  return left !== undefined && right !== undefined && left.name === right.name && left.mapping !== right.mapping;
}
