import type { ElementImpl } from '../dom/nodes/element';
import { isText, type NodeImpl } from '../dom/nodes/node';
import {
  CSSStyleDeclarationImpl, type CSSStyleSheetImpl, type TreeScope,
  type RuntimeCaps as StyleletRuntimeCaps,
} from '../../stylelet/index';
import type { RuntimeContext } from '../../js-engine/index';
import { createDOMException } from '../../web-idl/index';
import type { Realm } from '../scripting/realm';
import { domManipulationTaskSource } from '../scripting/tasks';

/** Compose Stylelet with this owner's task delivery, promises, and exception requests. */
export function createStyleletRuntime(realm: Realm, runtime: RuntimeContext): StyleletRuntimeCaps {
  return {
    promises: runtime.promises,
    runInParallel: runtime.runInParallel,
    // CSSOM leaves the source unspecified; DOM manipulation delivers stylesheet updates.
    queueTask: (steps) => { realm.queueGlobalTask(domManipulationTaskSource, steps); },
    createDOMException,
  };
}

export class ElementCSSInlineStyleMixin {
  style: CSSStyleDeclarationImpl;

  constructor(element: ElementImpl, runtime: StyleletRuntimeCaps) {
    this.style = new CSSStyleDeclarationImpl({
      ownerNode: element,
    }, runtime);
  }

  attributeChanged(value: string | null): void {
    this.style.attributeChanged('style', value);
  }
}

/* Deferred association hosts:
 * - external HTML links require the CSSOM fetch-a-CSS-style-sheet algorithm
 *   and HTML's linked-resource processing;
 * - XML processing instructions require an XML DOM host;
 * - HTTP Link headers require navigation response metadata.
 */
/*
 * interface mixin LinkStyle {
 *   readonly attribute CSSStyleSheet? sheet;
 * };
 */
export class LinkStyleMixin {
  #owner;
  #options;
  #treeScopeResolver;
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

  get sheet(): CSSStyleSheetImpl | null {
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
        this.#sheet.setAssociatedMedia(
          this.#owner.getAttribute('media') ?? '',
        );
        return;
      }

      if (qualifiedName === 'title') {
        this.#sheet.setAssociatedTitle(
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
  attributes: ReadonlySet<string>;
  children?: boolean;
};

export type TreeScopeResolver = {
  resolve(root: NodeImpl): TreeScope | null;
};
