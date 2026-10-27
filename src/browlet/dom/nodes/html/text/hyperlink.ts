import { InternalError } from '../../../../../infra/index';
import { attr, defineInterfaceMixin, idlType, reflect, xattr } from '../../../../../web-idl/core/index';
import { obtainURLOrigin, type Origin, type URLRecord } from '../../../../../url/index';

/** Retains the URL used by shared hyperlink algorithms. */
// https://html.spec.whatwg.org/multipage/links.html#hyperlink-element
export class HyperlinkElementUtilsMixin {
  url: URLRecord | null = null;

  // https://html.spec.whatwg.org/multipage/links.html#hyperlink-element
  extractOrigin(): Origin | null {
    return this.url === null ? null : obtainURLOrigin(this.url);
  }

  // https://html.spec.whatwg.org/multipage/links.html#concept-hyperlink-url-set
  setURL(): void {
    // TODO(HTML §4.6.4): Parse href against the document and connect attribute/base changes.
    throw new InternalError('Hyperlink URL lifecycle is not implemented');
  }
}

/*
 * interface mixin HyperlinkElementUtils {
 *   readonly attribute USVString origin;
 *   [CEReactions] attribute USVString protocol;
 *   [CEReactions] attribute USVString username;
 *   [CEReactions] attribute USVString password;
 *   [CEReactions] attribute USVString host;
 *   [CEReactions] attribute USVString hostname;
 *   [CEReactions] attribute USVString port;
 *   [CEReactions] attribute USVString pathname;
 *   [CEReactions] attribute USVString search;
 *   [CEReactions] attribute USVString hash;
 *   [CEReactions, Reflect] attribute DOMString hreflang;
 *   [CEReactions, Reflect] attribute DOMString type;
 * };
 */
export const hyperlinkElementUtilsIDL = defineInterfaceMixin({
  name: 'HyperlinkElementUtils',
  members: [
    // TODO(HTML §4.6.3): origin and the URL component accessors require URL reinitialization.
    attr('hreflang', idlType.DOMString, xattr('CEReactions', reflect())),
    attr('type', idlType.DOMString, xattr('CEReactions', reflect())),
  ],
});

/*
 * interface mixin HTMLHyperlinkElementUtils {
 *   [CEReactions, ReflectSetter] stringifier attribute USVString href;
 *   [CEReactions, Reflect] attribute DOMString target;
 * };
 */
// https://html.spec.whatwg.org/multipage/links.html#htmlhyperlinkelementutils
export const htmlHyperlinkElementUtilsIDL = defineInterfaceMixin({
  name: 'HTMLHyperlinkElementUtils',
  members: [
    // TODO(HTML §4.6.4): href and stringification require the unfinished URL lifecycle.
    attr('target', idlType.DOMString, xattr('CEReactions', reflect())),
  ],
});
