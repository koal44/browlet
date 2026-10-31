import { ElementTag } from '../../element-definitions/index';

/** The content attribute supplying a URL property value, or null for other elements. */
// https://html.spec.whatwg.org/multipage/microdata.html#url-property-elements
export function getMicrodataURLAttribute(tag: ElementTag): 'src' | 'href' | 'data' | null {
  switch (tag) {
    case ElementTag.HTMLAudio: case ElementTag.HTMLEmbed: case ElementTag.HTMLIframe:
    case ElementTag.HTMLImg: case ElementTag.HTMLSource: case ElementTag.HTMLTrack: case ElementTag.HTMLVideo:
      return 'src';
    case ElementTag.HTMLA: case ElementTag.HTMLArea: case ElementTag.HTMLLink:
      return 'href';
    case ElementTag.HTMLObject:
      return 'data';
    default:
      return null;
  }
}
