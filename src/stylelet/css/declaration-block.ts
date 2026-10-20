import { parseDeclarationList, type ParserInput, type ParsingContext } from '../syntax/index';

import {
  interpretPropertyDeclarations, serializePropertyDeclaration, type PropertyDeclaration,
} from './property';

/** Parsed declarations shared by style resolution and a separately created CSSOM object. */
// https://drafts.csswg.org/cssom/#css-declaration-blocks
export class CSSDeclarationBlock {
  #declarations: PropertyDeclaration[] = [];

  constructor(declarations: readonly PropertyDeclaration[] = []) {
    this.#replace(declarations);
  }

  /** Read declarations without bypassing replacement and importance handling. */
  get declarations(): readonly PropertyDeclaration[] {
    return this.#declarations;
  }

  get cssText(): string {
    return this.#declarations.map(serializeDeclaration).join(' ');
  }

  /** Replace the block with parsed attribute or CSSOM text. */
  setText(value: string, context: Partial<ParsingContext>): void {
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

  /** Set a parsed declaration; source-list replacement also respects prior importance. */
  set(declaration: PropertyDeclaration, respectImportance = false): boolean {
    const index = this.#declarations.findIndex(({ name }) => name === declaration.name);
    if (index < 0) {
      this.#declarations.push(declaration);
      return true;
    }

    const previous = this.#declarations[index]!;
    if (respectImportance && previous.important && !declaration.important) return false;

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

  /** Replace declarations in source order, preserving the winning importance. */
  #replace(declarations: readonly PropertyDeclaration[]): void {
    this.#declarations = [];
    for (const declaration of declarations) this.set(declaration, true);
  }
}

/** Parse supported property declarations without interpreting nested style rules. */
// https://drafts.csswg.org/cssom/#parse-a-css-declaration-block
// TODO: retain per-declaration parse-time URL bases when URL-valued properties are registered.
export function parseDeclarationBlock(input: ParserInput, context: Partial<ParsingContext>): PropertyDeclaration[] {
  return interpretPropertyDeclarations(parseDeclarationList(input, context));
}

/** Serialize one declaration without changing its value stage. */
function serializeDeclaration(declaration: PropertyDeclaration): string {
  const { name, value, important } = serializePropertyDeclaration(declaration);
  return `${name}: ${value}${important ? ' !important' : ''};`;
}
