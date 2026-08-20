import type { ElementImpl } from './nodes/element';
import { isText, type NodeImpl } from './nodes/node';
import { CSSStyleDeclarationImpl } from '../stylelet/cssom/declaration';
import type { CSSStyleSheetImpl } from '../stylelet/cssom/css-stylesheet';
import type { TreeScope } from '../stylelet/engine/tree-scope';
import {
  defineInterfaceMixin, definePartialInterfaceMixin, idlType, nullable,
} from '../web-idl/definition';

/*
 * partial interface mixin DocumentOrShadowRoot {
 *   [SameObject] readonly attribute StyleSheetList styleSheets;
 *   attribute ObservableArray<CSSStyleSheet> adoptedStyleSheets;
 * };
 */
export const cssomDocumentOrShadowRootIDL = definePartialInterfaceMixin({
  members: [
    {
      extendedAttributes: [{ kind: 'no-arguments', name: 'SameObject' }],
      kind: 'attribute', name: 'styleSheets', readonly: true,
      type: idlType.object,
    },
    // TODO(Web IDL observable arrays): Restore ObservableArray<CSSStyleSheet>
    // when the specialized attribute proxy is available.
    { kind: 'attribute', name: 'adoptedStyleSheets', type: idlType.any },
  ],
  name: 'DocumentOrShadowRoot',
});

export class DocumentOrShadowRootMixin {
  constructor(readonly scope: TreeScope) {}

  get styleSheets(): StyleSheetList {
    return this.scope.styleSheets;
  }

  get adoptedStyleSheets(): CSSStyleSheet[] {
    return this.scope.adoptedStyleSheets;
  }

  set adoptedStyleSheets(styleSheets: CSSStyleSheet[]) {
    this.scope.setAdoptedStyleSheets(styleSheets);
  }
}

/*
 * interface mixin ElementCSSInlineStyle {
 *   [SameObject, PutForwards=cssText]
 *   readonly attribute CSSStyleProperties style;
 * };
 */
export const elementCSSInlineStyleIDL = defineInterfaceMixin({
  members: [{
    extendedAttributes: [
      { kind: 'no-arguments', name: 'SameObject' },
      { kind: 'identifier', name: 'PutForwards', value: 'cssText' },
    ],
    kind: 'attribute',
    name: 'style',
    readonly: true,
    type: idlType.object,
  }],
  name: 'ElementCSSInlineStyle',
});

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
export const linkStyleIDL = defineInterfaceMixin({
  members: [{
    kind: 'attribute', name: 'sheet', readonly: true,
    type: nullable(idlType.object),
  }],
  name: 'LinkStyle',
});

/* Deferred association hosts:
 * - external HTML links require the CSSOM fetch-a-CSS-style-sheet algorithm
 *   and HTML's linked-resource processing;
 * - XML processing instructions require an XML DOM host;
 * - HTTP Link headers require navigation response metadata.
 */
export class LinkStyleMixin {
  readonly #owner;
  readonly #options;
  readonly #treeScopeResolver;
  #sheet: CSSStyleSheetImpl | null = null;
  #scope: TreeScope | null = null;
  #deferred = false;

  constructor(
    owner: ElementImpl,
    options: LinkStyleOptions,
    treeScopeResolver: TreeScopeResolver,
  ) {
    this.#owner = owner;
    this.#options = options;
    this.#treeScopeResolver = treeScopeResolver;
  }

  get sheet(): CSSStyleSheet | null {
    return this.#sheet;
  }

  beginParsingChildren(): void {
    if (!this.#options.children) return;
    this.#deferred = true;
  }

  finishParsingChildren(): void {
    if (!this.#options.children) return;
    this.#deferred = false;
    this.update();
  }

  childrenChanged(): void {
    if (this.#options.children) this.update();
  }

  attributeChanged(qualifiedName: string): void {
    if (!this.#options.attributes.has(qualifiedName)) return;

    if (this.#sheet) {
      if (qualifiedName === 'media') {
        this.#sheet.__setAssociatedMedia(
          this.#owner.getAttribute('media') ?? '',
        );
        return;
      }

      if (qualifiedName === 'title') {
        this.#sheet.__setAssociatedTitle(
          this.#owner.getAttribute('title') ?? '',
        );
        return;
      }
    }

    this.update();
  }

  update(): void {
    if (this.#deferred) return;

    if (this.#sheet && this.#scope) {
      this.#scope.removeStyleSheet(this.#sheet);
    }
    this.#sheet = null;
    this.#scope = null;

    const type = this.#owner.getAttribute('type')?.toLowerCase() ?? '';
    if (!this.#owner.isConnected) return;

    // External links remain unassociated until Browlet exposes a response-
    // bearing resource loader to HTML's linked-resource processing model.
    if (this.#owner.localName === 'link') return;

    if (type !== '' && type !== 'text/css') {
      return;
    }

    const scope = this.#treeScopeResolver.resolve(this.#owner.getRootNode());
    if (!scope) return;

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

export type LinkStyleOptions = {
  readonly attributes: ReadonlySet<string>;
  readonly children?: boolean;
};

export type TreeScopeResolver = {
  resolve(root: NodeImpl): TreeScope | null;
};
