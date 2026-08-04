import { BlockItemAstKind, serializeAstDeclaration, type SerializedDeclarationAst, type DeclarationAst, type StyleBlockAst } from './ast';
import { notImplemented } from './util';

export class SelectletCSSStyleDeclaration {
  [index: number]: string;

  private _names: string[] = [];
  private _declarations = new Map<string, SerializedDeclarationAst>();

  constructor(block?: StyleBlockAst) {
    if (block) {
      this.load(block);
    }
  }

  get cssText(): string {
    return '';
  }

  set cssText(_value: string) {
    notImplemented('CSSStyleDeclaration.cssText');
  }

  get length(): number {
    return this._names.length;
  }

  get parentRule(): CSSRule | null {
    return null;
  }

  getPropertyPriority(property: string): string {
    return this._declarations.get(normalizePropertyName(property))?.important ? 'important' : '';
  }

  getPropertyValue(property: string): string {
    return this._declarations.get(normalizePropertyName(property))?.value ?? '';
  }

  item(index: number): string {
    return this._names[index] ?? '';
  }

  removeProperty(_property: string): string {
    return notImplemented('CSSStyleDeclaration.removeProperty');
  }

  setProperty(_property: string, _value: string | null, _priority?: string): void {
    notImplemented('CSSStyleDeclaration.setProperty');
  }

  [Symbol.iterator](): ArrayIterator<string> {
    return this._names[Symbol.iterator]();
  }

  private load(block: StyleBlockAst): void {
    for (const item of block.items) {
      if (item.kind !== BlockItemAstKind.Declaration) continue;
      this.addDeclaration(item);
    }
  }

  private addDeclaration(declaration: DeclarationAst): void {
    const active = serializeAstDeclaration(declaration);
    if (!active) return;
    this.setActiveDeclaration(active);
  }

  private setActiveDeclaration(declaration: SerializedDeclarationAst): void {
    const name = declaration.name;
    const previous = this._declarations.get(name);

    if (previous?.important && !declaration.important) {
      return;
    }

    if (!previous) {
      this[this._names.length] = name;
      this._names.push(name);
    }

    this._declarations.set(name, {
      ...declaration,
      name,
    });
  }
}

function normalizePropertyName(name: string): string {
  return name.startsWith('--') ? name : name.toLowerCase();
}
