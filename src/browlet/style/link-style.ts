import type { CSSStyleSheetImpl, TreeScope } from '../../stylelet/index';

import type { ElementImpl } from '../dom/nodes/index';

// External links await HTML linked-resource processing; PI and HTTP-header
// associations have separate owners in processing-instruction.ts and Document.
/** Maintains a style element's sheet as its attributes, text, and tree scope change. */
// https://drafts.csswg.org/cssom/#the-linkstyle-interface
// The declaration lives in Stylelet; Browlet owns the DOM association behavior.
export class LinkStyleMixin {
  /** Associated sheet, or null while detached or unsupported. */
  sheet: CSSStyleSheetImpl | null = null;
  /** Element whose attributes and text determine the associated stylesheet. */
  #owner: ElementImpl;
  /** Inputs that trigger this element's stylesheet association updates. */
  #options: LinkStyleOptions;
  /** Scope retaining the current sheet, needed to remove it after a tree move. */
  #scope: TreeScope | null = null;
  /** Whether the parser is still supplying this element's stylesheet text. */
  #deferred = false;

  constructor(owner: ElementImpl, options: LinkStyleOptions) {
    this.#owner = owner;
    this.#options = options;
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

    // TODO(HTML link processing): Connect HTML's linked-resource lifecycle to
    // Document's fetchCSSStyleSheet()/createFetchedStyleSheet(), which own Fetch,
    // MIME, decoding, and URL provenance. This mixin currently handles inline sheets.
    // https://html.spec.whatwg.org/#link-type-stylesheet
    if (!this.#options.children) return;

    if (type !== '' && type !== 'text/css') {
      return;
    }

    const root = this.#owner.getRoot();
    if (!root.isDocument() && !root.isShadowRoot()) return;
    const scope = root.getStyleScope();

    let source = '';
    for (
      let child = this.#owner.firstChild;
      child;
      child = child.nextSibling
    ) {
      if (child.isText()) source += child.data;
    }

    // TODO(HTML stylesheet resources): CSSOM's add-a-sheet step 2 must register
    // contributing owners with Document.addScriptBlockingStyleSheet(), then load
    // completion must call removeScriptBlockingStyleSheet(). The predicate needs
    // parser creation, media applicability, and pending critical resources.
    // Inline association is synchronous; start loadStyleSheetImports() explicitly
    // and consume completion as part of the external-sheet lifecycle.
    // https://drafts.csswg.org/cssom/#add-a-css-style-sheet
    // https://html.spec.whatwg.org/#contributes-a-script-blocking-style-sheet
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
