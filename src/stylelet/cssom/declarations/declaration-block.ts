import { parseDeclarationList, type ParserInput } from '../../syntax/index';
import {
  interpretPropertyDeclarations, serializePropertyDeclaration, type PropertyDeclaration, type PropertyContext,
} from '../../props/index';

/** Parsed declarations shared by style resolution and a separately created CSSOM object. */
// https://drafts.csswg.org/cssom/#css-declaration-blocks
// PROVISIONAL(CSSOM): This separate storage/mutation class is an interim inline-style design.
// Before closing the CSSOM audit, replace it with plain declaration state or direct
// implementation ownership unless a separate class earns an explicit justification.
// See ROADMAP.md#declaration-state-and-lifecycle.
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
    return this.#declarations.map(serializeDeclaration).join(' ');
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

  /** Set a declaration through CSSOM, retaining an existing property's position. */
  set(declaration: PropertyDeclaration): boolean {
    const index = this.#declarations.findIndex(({ name }) => name === declaration.name);
    if (index < 0) {
      this.#declarations.push(declaration);
      return true;
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

/** Serialize one declaration without changing its value stage. */
function serializeDeclaration(declaration: PropertyDeclaration): string {
  const { name, value, important } = serializePropertyDeclaration(declaration);
  return `${name}: ${value}${important ? ' !important' : ''};`;
}
