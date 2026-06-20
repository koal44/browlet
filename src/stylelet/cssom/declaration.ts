import {
  BlockItemKind,
  type DeclarationAst, type RawDeclarationAst, type StyleBlockAst,
} from '../parser/types';
import { notImplemented } from '../util';

type ActiveDeclaration = {
  name: string;
  value: string;
  important: boolean;
};

export class SelectletCSSStyleDeclaration {
  [index: number]: string;

  private _names: string[] = [];
  private _declarations = new Map<string, ActiveDeclaration>();

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
      if (item.kind !== BlockItemKind.Declaration) continue;
      this.addDeclaration(item);
    }
  }

  private addDeclaration(declaration: DeclarationAst): void {
    if (!isRawDeclaration(declaration)) {
      return;
    }

    this.setActiveDeclaration({
      name: declaration.name,
      value: declaration.value,
      important: declaration.important,
    });
  }

  private setActiveDeclaration(declaration: ActiveDeclaration): void {
    const name = normalizePropertyName(declaration.name);
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

export function createCSSStyleDeclaration(block?: StyleBlockAst): CSSStyleDeclaration {
  return new SelectletCSSStyleDeclaration(block) as unknown as CSSStyleDeclaration;
}

function isRawDeclaration(declaration: DeclarationAst): declaration is RawDeclarationAst {
  return 'raw' in declaration;
}

function normalizePropertyName(name: string): string {
  return name.toLowerCase();
}
