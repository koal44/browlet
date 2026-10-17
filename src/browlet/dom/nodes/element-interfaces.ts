import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../../../infra/index';

import { ElementImpl } from './element';
import {
  HTMLElementImpl, HTMLUnknownElementImpl, htmlIDLDefinitions,
} from './html/index';
import { isValidCustomElementName } from './html/custom-elements/index';
import { MathMLElementImpl, mathMLIDLDefinitions } from './mathml/index';
import { SVGElementImpl, svgIDLDefinitions } from './svg/index';

/** Select an element's implementation, including namespace and unknown-name fallbacks. */
export function getElementConstructor(
  namespaceURI: string,
  localName: string,
): typeof ElementImpl {
  const exact = elementConstructors.get(namespaceURI)?.get(localName);
  if (exact) return exact;

  if (namespaceURI === HTML_NAMESPACE) {
    if (legacyUnknownHTMLLocalNames.has(localName)) {
      return HTMLUnknownElementImpl;
    }
    if (
      knownHTMLLocalNames.has(localName) ||
      isValidCustomElementName(localName)
    ) {
      return HTMLElementImpl;
    }
    return HTMLUnknownElementImpl;
  }
  if (namespaceURI === SVG_NAMESPACE) return SVGElementImpl;
  if (namespaceURI === MATHML_NAMESPACE) return MathMLElementImpl;
  return ElementImpl;
}

const elementConstructors = collectElementConstructors();

function collectElementConstructors(): Map<string, Map<string, typeof ElementImpl>> {
  const namespaces = new Map<string, Map<string, typeof ElementImpl>>();

  for (const definition of [...htmlIDLDefinitions, ...svgIDLDefinitions, ...mathMLIDLDefinitions]) {
    if (definition.kind !== 'interface' || definition.localNames === undefined) continue;
    // Declaration tests require a namespace, an Element implementation, and unique names.
    const namespaceURI = definition.namespaceURI!;
    const implementation = definition.implementation!.implClass as typeof ElementImpl;
    let localNames = namespaces.get(namespaceURI);
    if (!localNames) {
      localNames = new Map();
      namespaces.set(namespaceURI, localNames);
    }
    for (const localName of definition.localNames) localNames.set(localName, implementation);
  }

  return namespaces;
}

// https://html.spec.whatwg.org/multipage/dom.html#elements-in-the-dom
// PROVISIONAL(element registration): transitional fallback until every HTML name
// is registered. Missing dedicated implementations receive HTMLElement; names
// that use HTMLElement by design belong in its localNames. Exact registrations
// take precedence; remove this set once both groups are fully registered.
const knownHTMLLocalNames = new Set([
  'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside',
  'audio', 'b', 'base', 'basefont', 'bdi', 'bdo', 'bgsound', 'big',
  'blink', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center',
  'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del',
  'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt', 'em',
  'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head',
  'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input',
  'ins', 'isindex', 'kbd', 'keygen', 'label', 'legend', 'li', 'link',
  'listing', 'main', 'map', 'mark', 'marquee', 'menu', 'menuitem', 'meta',
  'meter', 'multicol', 'nav', 'nextid', 'nobr', 'noembed', 'noframes',
  'noscript', 'object', 'ol', 'optgroup', 'option', 'output', 'p', 'param',
  'picture', 'plaintext', 'pre', 'progress', 'q', 'rb', 'rp', 'rt',
  'rtc', 'ruby', 's', 'samp', 'script', 'search', 'section', 'select',
  'selectedcontent', 'slot', 'small', 'source', 'spacer', 'span', 'strike',
  'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
  'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr', 'xmp',
]);

// These obsolete names require HTMLUnknownElement; they are not missing implementations.
const legacyUnknownHTMLLocalNames = new Set([
  'applet', 'bgsound', 'blink', 'isindex', 'keygen', 'multicol', 'nextid',
  'spacer',
]);
