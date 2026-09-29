import type { ElementImpl } from '../dom/nodes/element';
import type { NodeImpl } from '../dom/nodes/node';
import {
  CSSStyleDeclarationImpl, type CSSStyleSheetImpl, type TreeScope,
  type StyleletEnvironment,
} from '../../stylelet/index';

/** Owns an element's inline declaration and synchronizes its style attribute. */
// https://drafts.csswg.org/cssom/#elementcssinlinestyle
export class ElementCSSInlineStyleMixin {
  /** Retained declaration updated by both CSSOM writes and attribute changes. */
  style: CSSStyleDeclarationImpl;

  constructor(element: ElementImpl, env: StyleletEnvironment) {
    this.style = new CSSStyleDeclarationImpl({ ownerNode: element }, env);
  }

  attributeChanged(value: string | null): void {
    this.style.attributeChanged('style', value);
  }
}

// External links await CSSOM fetching and HTML linked-resource processing;
// XML processing instructions and HTTP Link headers await their host owners.
/** Maintains a style element's sheet as its attributes, text, and tree scope change. */
// https://drafts.csswg.org/cssom/#the-linkstyle-interface
// The declaration lives in Stylelet; Browlet owns the DOM association behavior.
export class LinkStyleMixin {
  #owner;
  #options;
  #treeScopeResolver;
  /** Associated sheet, or null while detached or unsupported. */
  sheet: CSSStyleSheetImpl | null = null;
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

  /** Delay sheet creation until the parser has supplied the full style text. */
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

    if (this.sheet) {
      if (qualifiedName === 'media') {
        this.sheet.setAssociatedMedia(
          this.#owner.getAttribute('media') ?? '',
        );
        return;
      }

      if (qualifiedName === 'title') {
        this.sheet.setAssociatedTitle(
          this.#owner.getAttribute('title') ?? '',
        );
        return;
      }
    }

    this.update();
  }

  /** Rebuild the association from the owner's current text, attributes, and root. */
  update(): void {
    if (this.#deferred) return;

    if (this.sheet && this.#scope) {
      this.#scope.removeStyleSheet(this.sheet);
    }
    this.sheet = null;
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
      if (child.isText()) source += child.data;
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
    this.sheet = sheet;
  }
}

export type LinkStyleOptions = {
  /** Attributes whose changes affect stylesheet association. */
  attributes: ReadonlySet<string>;
  /** Whether the element's child text supplies the stylesheet source. */
  children?: boolean;
};

export type TreeScopeResolver = {
  /** Style owner for a document or shadow root, if that scope supports stylesheets. */
  resolve(root: NodeImpl): TreeScope | null;
};
