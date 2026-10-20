import type { DOMElement, DOMProcessingInstruction } from '../../infra/index';
import { attr, defineInterface, idlType, impl, nullable, reference, roAttr, union, xattr } from '../../web-idl/core/index';

import type { StyleletEnvironment, StyleletURL } from '../environment';

import { MediaListImpl } from './media-list';
import type { CSSStyleSheetImpl } from './css-stylesheet';

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
export abstract class StyleSheetImpl {
  type = 'text/css';
  /** Parsed location retained for internal URL resolution; href exposes its string. */
  location: StyleletURL | null = null;
  ownerNode: DOMElement | DOMProcessingInstruction | null = null;
  parentStyleSheet: CSSStyleSheetImpl | null = null;
  media: MediaListImpl;
  disabled = false;

  protected titleText = '';
  protected env: StyleletEnvironment;

  constructor(media: string, env: StyleletEnvironment) {
    this.env = env;
    this.media = new MediaListImpl(media);
  }

  get href(): string | null {
    return this.location?.href ?? null;
  }

  get title(): string | null {
    return this.titleText === '' ? null : this.titleText;
  }
}

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
