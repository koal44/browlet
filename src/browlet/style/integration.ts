import {
  CSSDeclarationBlock, CSSStyleDeclarationImpl,
  type CSSStyleSheetImpl, type TreeScope, type StyleletEnvironment,
} from '../../stylelet/index';

import type { ElementImpl, NodeImpl } from '../dom/nodes/index';

/** Owns accepted inline declarations and lazily exposes their CSSOM object. */
// https://drafts.csswg.org/cssom/#elementcssinlinestyle
export class ElementCSSInlineStyleMixin {
  #element: ElementImpl;
  #env: StyleletEnvironment;
  #block?: CSSDeclarationBlock;
  #style?: CSSStyleDeclarationImpl;

  /** Retain the owner without allocating a declaration or reading its attributes. */
  constructor(element: ElementImpl, env: StyleletEnvironment) {
    this.#element = element;
    this.#env = env;
  }

  /** Obtain the retained CSSOM object without reading or reparsing the attribute. */
  get style(): CSSStyleDeclarationImpl {
    return this.#style ??= new CSSStyleDeclarationImpl({
      block: this.#block ??= new CSSDeclarationBlock(),
      ownerNode: this.#element,
    }, this.#env);
  }

  /** Read accepted declarations without creating CSSOM or parsing the raw attribute. */
  getInlineStyleBlock(): CSSDeclarationBlock | null {
    return this.#block ?? null;
  }

  /** Check and apply attribute input, including the first assignment. */
  // https://html.spec.whatwg.org/multipage/dom.html#the-style-attribute
  attributeChanged(value: string | null): void {
    // CSSOM write-back has already updated the declaration; it bypasses CSP and parsing.
    if (this.#style?.updating) return;
    if (value === null) {
      this.#block?.clear();
    } else {
      // SPEC_CLASH(csp-blocked-style-attribute): Chromium/WebKit retain both the
      // raw attribute and prior accepted declarations; Firefox clears both.
      if (this.#element.nodeDocument.env.policyContainer.cspList!
        .isStyleAttributeBlocked(this.#element, value)) return;
      (this.#block ??= new CSSDeclarationBlock()).setText(value, {});
    }
    this.#style?.synchronizeIndices();
  }
}

// External links await CSSOM fetching and HTML linked-resource processing;
// XML processing instructions and HTTP Link headers await their host owners.
/** Maintains a style element's sheet as its attributes, text, and tree scope change. */
// https://drafts.csswg.org/cssom/#the-linkstyle-interface
// The declaration lives in Stylelet; Browlet owns the DOM association behavior.
export class LinkStyleMixin {
  /** Associated sheet, or null while detached or unsupported. */
  sheet: CSSStyleSheetImpl | null = null;
  #owner;
  #options;
  #treeScopeResolver;
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
    // TODO: Decode stylesheet bytes with the response's charset label and the
    // referring document's encoding before parsing. Retain the BOM-selected
    // encoding for @import and the final response URL for relative references.
    // https://drafts.csswg.org/css-syntax-3/#input-byte-stream
    if (!this.#options.children) return;

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
