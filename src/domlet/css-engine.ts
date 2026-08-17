import type {
  HTMLLinkElementImpl, HTMLStyleElementImpl, SVGStyleElementImpl,
} from './nodes/element';
import { isText } from './nodes/node';
import { CSSStyleDeclarationImpl } from '../stylelet/cssom/declaration';
import type { CSSStyleSheetImpl } from '../stylelet/cssom/css-stylesheet';
import type { TreeScope } from '../stylelet/engine/tree-scope';

/*
 * interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 * };
 */
export class DocumentOrShadowRootMixin {
  constructor(readonly scope: TreeScope) {}

  get styleSheets(): StyleSheetList {
    return this.scope.styleSheets;
  }
}

/*
 * interface mixin ElementCSSInlineStyle {
 *   [SameObject, PutForwards=cssText]
 *   readonly attribute CSSStyleProperties style;
 * };
 */
export class ElementCSSInlineStyleMixin {
  readonly style: CSSStyleDeclarationImpl;

  constructor(element: Element) {
    this.style = new CSSStyleDeclarationImpl({
      ownerNode: element,
    });
  }

  attributeChanged(value: string | null): void {
    this.style.__attributeChanged('style', value);
  }
}

/*
 * interface mixin LinkStyle {
 *   readonly attribute CSSStyleSheet? sheet;
 * };
 */
export class LinkStyleMixin {
  readonly #owner;
  readonly #behavior;
  #sheet: CSSStyleSheetImpl | null = null;
  #scope: TreeScope | null = null;
  #deferred = false;

  constructor(
    owner: HTMLLinkElementImpl | HTMLStyleElementImpl | SVGStyleElementImpl,
    behavior: { attributes: Set<string>; children?: boolean; }
  ) {
    this.#owner = owner;
    this.#behavior = behavior;
  }

  get sheet(): CSSStyleSheet | null {
    return this.#sheet;
  }

  beginParsingChildren(): void {
    if (!this.#behavior.children) return;
    this.#deferred = true;
  }

  finishParsingChildren(): void {
    if (!this.#behavior.children) return;
    this.#deferred = false;
    this.update();
  }

  childrenChanged(): void {
    if (this.#behavior.children) this.update();
  }

  attributeChanged(qualifiedName: string): void {
    if (this.#behavior.attributes.has(qualifiedName)) this.update();
  }

  update(): void {
    if (this.#deferred) return;

    if (this.#sheet && this.#scope) {
      this.#scope.removeStyleSheet(this.#sheet);
    }
    this.#sheet = null;
    this.#scope = null;

    const type = this.#owner.getAttribute('type')?.toLowerCase() ?? '';
    if (
      !this.#owner.isConnected ||
      this.#owner.localName === 'link' ||
      (type !== '' && type !== 'text/css')
    ) {
      return;
    }

    const scope = getTreeScope(this.#owner);

    let source = '';
    for (
      let child = this.#owner.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (isText(child)) source += child.data;
    }

    const sheet = scope.createStyleElementStyleSheet(
      this.#owner,
      source,
      {
        media: this.#owner.getAttribute('media') ?? '',
        title: this.#owner.getAttribute('title') ?? '',
      },
    );
    this.#scope = scope;
    this.#sheet = sheet;
  }
}

type TreeScopeRoot = Node & {
  readonly __treeScope: TreeScope;
};

function getTreeScope(element: Element): TreeScope {
  return (element.getRootNode() as TreeScopeRoot).__treeScope;
}
