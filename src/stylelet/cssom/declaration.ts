import { notImplemented } from '../util';

export class SelectletCSSStyleDeclaration {
  [index: number]: string;

  private _names: string[] = [];

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

  getPropertyPriority(_property: string): string {
    return '';
  }

  getPropertyValue(_property: string): string {
    return '';
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
}

export function createCSSStyleDeclaration(): CSSStyleDeclaration {
  return new SelectletCSSStyleDeclaration() as unknown as CSSStyleDeclaration;
}
