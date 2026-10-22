import { getShorthands, type PropertyContext, type ShorthandRecord } from '../../props/index';

import { InterpretedDeclaration, type BuiltInDeclaration } from './interpreted-declaration';

/** Parsed declarations shared by style resolution and a separately created CSSOM object. */
// https://drafts.csswg.org/cssom/#css-declaration-blocks
// This collection owns ordering and mutation, not the associated CSSOM flags,
// owner, or Platform identity. Inline style can retain it before .style is read.
export class CSSDeclarationBlock {
  /** Winning declaration for each property, retaining the block's property order. */
  #declarations: InterpretedDeclaration[] = [];

  /** Collect the initial declarations with source-order and importance handling. */
  constructor(declarations: readonly InterpretedDeclaration[] = []) {
    this.#replace(declarations);
  }

  /** Read declarations without bypassing replacement and importance handling. */
  get declarations(): readonly InterpretedDeclaration[] {
    return this.#declarations;
  }

  /** Serialize the retained declarations at their current value stage. */
  // https://drafts.csswg.org/cssom/#serialize-a-css-declaration-block
  get cssText(): string {
    const serialized: string[] = [];
    const alreadySerialized = new Set<string>();
    for (const declaration of this.#declarations) {
      if (alreadySerialized.has(declaration.name)) continue;
      const shorthand = this.#serializeShorthand(declaration, alreadySerialized);
      if (shorthand !== null) {
        serialized.push(shorthand);
        continue;
      }
      serialized.push(declaration.serialize());
      alreadySerialized.add(declaration.name);
    }
    return serialized.join(' ');
  }

  /** Replace the block with parsed attribute or CSSOM text. */
  setText(value: string, context: PropertyContext): void {
    this.#replace(InterpretedDeclaration.parseBlock(value, context));
  }

  /** Remove all declarations while preserving the block's identity. */
  clear(): void {
    this.#declarations = [];
  }

  /** Find a declaration by its normalized property name. */
  find(name: string): InterpretedDeclaration | undefined {
    return this.#declarations.find((declaration) => declaration.name === name);
  }

  /** Return complete, equally important shorthand longhands in canonical order, or null. */
  getLonghands(shorthand: ShorthandRecord): BuiltInDeclaration[] | null {
    const longhands: BuiltInDeclaration[] = [];
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
  set(declaration: InterpretedDeclaration): boolean {
    const index = this.#declarations.findIndex(({ name }) => name === declaration.name);
    if (index < 0) {
      this.#declarations.push(declaration);
      return true;
    }

    for (let i = index + 1; i < this.#declarations.length; i++) {
      if (declaration.hasDifferentMapping(this.#declarations[i]!)) {
        this.#declarations.splice(index, 1);
        this.#declarations.push(declaration);
        return true;
      }
    }

    const previous = this.#declarations[index]!;
    const previousValue = previous.serializeValue();
    const nextValue = declaration.serializeValue();
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

  /** Serialize a complete compatible shorthand and record the longhands it consumes. */
  // https://drafts.csswg.org/cssom/#serialize-into-a-shorthand-form
  #serializeShorthand(declaration: InterpretedDeclaration, alreadySerialized: Set<string>): string | null {
    if (declaration.custom) return null;
    for (const [name, shorthand] of getShorthands(declaration.name)) {
      const longhands = this.getLonghands(shorthand);
      if (longhands === null || longhands.some(({ name }) => alreadySerialized.has(name))) continue;
      if (this.#hasInterleavedLogicalGroup(longhands)) continue;
      const value = shorthand.serialize(longhands.map(({ value }) => value));
      if (value === '') continue;
      for (const longhand of longhands) alreadySerialized.add(longhand.name);
      return InterpretedDeclaration.serializeText(name, value, declaration.important);
    }
    return null;
  }

  /** Whether combining these longhands would reorder an intervening opposite logical mapping. */
  // https://drafts.csswg.org/cssom/#intermixed-properties
  #hasInterleavedLogicalGroup(longhands: BuiltInDeclaration[]): boolean {
    const indices = longhands.map((declaration) => this.#declarations.indexOf(declaration));
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    for (let i = first + 1; i < last; i++) {
      const declaration = this.#declarations[i]!;
      if (longhands.some((longhand) => longhand === declaration)) continue;
      if (longhands.some((longhand) => longhand.hasDifferentMapping(declaration))) return true;
    }
    return false;
  }

  /** Keep each winning declaration at its specified position, rather than its first occurrence. */
  // https://drafts.csswg.org/cssom/#concept-declarations-specified-order
  // SPEC_CLASH(important-declaration-order): Follow CSSOM/Firefox's winning position;
  // Chromium/WebKit move an earlier important winner to a later losing declaration's position.
  #replace(declarations: readonly InterpretedDeclaration[]): void {
    const winners = new Map<string, InterpretedDeclaration>();
    for (const declaration of declarations) {
      const previous = winners.get(declaration.name);
      if (previous?.important && !declaration.important) continue;
      winners.delete(declaration.name);
      winners.set(declaration.name, declaration);
    }
    this.#declarations = [...winners.values()];
  }
}
