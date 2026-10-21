import type { DOMElement, DOMProcessingInstruction } from '../../infra/index';
import { attr, defineInterface, idlType, impl, nullable, reference, roAttr, union, xattr } from '../../web-idl/core/index';

import type { StyleletEnvironment, StyleletURL } from '../environment';
import { MediaListImpl } from './media/index';

import type { CSSStyleSheetImpl } from './css-stylesheet';

/** Sheet metadata and the retained media list shared by CSS stylesheets. */
// https://drafts.csswg.org/cssom/#the-stylesheet-interface
export abstract class StyleSheetImpl {
  /** MIME type of the sheet's styling language; Stylelet supports CSS. */
  type = 'text/css';
  /** Parsed location retained for internal URL resolution; href exposes its string. */
  location: StyleletURL | null = null;
  /** Element or processing instruction that owns the sheet, or null when unattached. */
  ownerNode: DOMElement | DOMProcessingInstruction | null = null;
  /** Sheet containing the importing rule, or null for a sheet that was not imported. */
  parentStyleSheet: CSSStyleSheetImpl | null = null;
  /** Live media conditions that restrict where this sheet applies. */
  media: MediaListImpl;
  /** Whether the sheet is excluded from style application. */
  disabled = false;

  /** Stylesheet-set title; an empty string means the sheet has no title. */
  protected titleText = '';
  /** Owning environment for execution and host DOM access. */
  protected env: StyleletEnvironment;

  /** Create the sheet's media list in its owning environment. */
  constructor(media: string, env: StyleletEnvironment) {
    this.env = env;
    this.media = new MediaListImpl(media);
  }

  /** Serialized sheet location, or null when the sheet has no location. */
  // https://drafts.csswg.org/cssom/#dom-stylesheet-href
  get href(): string | null {
    return this.location?.href ?? null;
  }

  /** Stylesheet-set title exposed to authors, or null when no title is assigned. */
  // https://drafts.csswg.org/cssom/#dom-stylesheet-title
  get title(): string | null {
    return this.titleText === '' ? null : this.titleText;
  }
}

/*
 * [Exposed=Window]
 * interface StyleSheet {
 *   readonly attribute CSSOMString type;
 *   readonly attribute USVString? href;
 *   readonly attribute (Element or ProcessingInstruction)? ownerNode;
 *   readonly attribute CSSStyleSheet? parentStyleSheet;
 *   readonly attribute DOMString? title;
 *   [SameObject, PutForwards=mediaText] readonly attribute MediaList media;
 *   attribute boolean disabled;
 * };
 */
export const styleSheetIDL = defineInterface({
  name: 'StyleSheet',
  exposed: 'Window',
  implementation: impl(StyleSheetImpl),
  members: [
    roAttr('type', reference('CSSOMString')),
    roAttr('href', nullable(idlType.USVString)),
    roAttr('ownerNode', nullable(union(reference('Element'), reference('ProcessingInstruction')))),
    roAttr('parentStyleSheet', nullable(reference('CSSStyleSheet'))),
    roAttr('title', nullable(idlType.DOMString)),
    roAttr('media', reference(MediaListImpl), xattr('SameObject', ['PutForwards', 'mediaText'])),
    attr('disabled', idlType.boolean),
  ],
});
