import type {
  HTMLLinkElementImpl, HTMLStyleElementImpl, SVGStyleElementImpl,
} from './nodes/element';
import type { DomletDocument } from './nodes/document';
import { isText } from './nodes/node';
import {
  createStyleletEnvironment, type Stylelet,
} from '../stylelet/stylelet';
import { CSSStyleDeclarationImpl } from '../stylelet/cssom/declaration';
import type { CSSStyleSheetImpl } from '../stylelet/cssom/css-stylesheet';
import type { InlineStyleSheetOptions } from '../stylelet/engine/document-or-shadow-root';

/*
 * interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 * };
 */
export class DocumentStyleState {
  readonly #document: Document;
  #environment: ReturnType<typeof createStyleletEnvironment> | undefined;

  constructor(document: Document) {
    this.#document = document;
  }

  get engine(): Stylelet {
    return this.environment.stylelet;
  }

  get styleSheets(): StyleSheetList {
    return this.environment.state.styleSheets;
  }

  createInlineStyleSheet(
    ownerNode: Element,
    source: string,
    options: InlineStyleSheetOptions = {},
  ): CSSStyleSheetImpl {
    return this.environment.state.createInlineStyleSheet(
      ownerNode,
      source,
      options,
    );
  }

  removeStyleSheet(styleSheet: CSSStyleSheetImpl): void {
    this.environment.state.removeStyleSheet(styleSheet);
  }

  private get environment() {
    return this.#environment ??= createStyleletEnvironment(this.#document);
  }
}

/*
 * interface mixin ElementCSSInlineStyle {
 *   [SameObject, PutForwards=cssText]
 *   readonly attribute CSSStyleProperties style;
 * };
 */
export class InlineStyleState {
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
export class LinkStyleState {
  readonly #owner;
  readonly #behavior;
  #sheet: CSSStyleSheetImpl | null = null;
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

    const document = this.#owner.ownerDocument as DomletDocument;
    const styleState = document.__styleState;
    if (this.#sheet) styleState.removeStyleSheet(this.#sheet);

    const type = this.#owner.getAttribute('type')?.toLowerCase() ?? '';
    if (
      !this.#owner.isConnected ||
      this.#owner.localName === 'link' ||
      (type !== '' && type !== 'text/css')
    ) {
      this.#sheet = null;
      return;
    }

    let source = '';
    for (
      let child = this.#owner.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (isText(child)) source += child.data;
    }

    this.#sheet = styleState.createInlineStyleSheet(
      this.#owner,
      source,
      {
        media: this.#owner.getAttribute('media') ?? '',
        title: this.#owner.getAttribute('title') ?? '',
      },
    );
  }
}
