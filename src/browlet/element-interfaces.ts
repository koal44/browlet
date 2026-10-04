import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../infra/index';
import {
  elementInterface, type ElementInterface,
} from './dom/nodes/element';
import { isValidCustomElementName } from './html/custom-elements/names';
import { htmlElementInterface } from './html/elements/html-element';
import { htmlUnknownElementInterface } from './html/elements/html-unknown-element';
import { htmlHeadElementInterface } from './html/elements/metadata/head';
import { htmlBaseElementInterface } from './html/elements/metadata/base';
import { htmlLinkElementInterface } from './html/elements/metadata/link';
import { htmlStyleElementInterface } from './html/elements/metadata/style';
import { mathMLElementInterface } from './mathml/element';
import { svgElementInterface } from './svg/element';
import { svgStyleElementInterface } from './svg/style-element';
import { InternalError } from '../infra/internal-error';

/** Select an element's implementation, including namespace and unknown-name fallbacks. */
export function resolveElementInterface(
  namespaceURI: string,
  localName: string,
): ElementInterface {
  const exact = elementInterfaces.get(namespaceURI, localName);
  if (exact) return exact;

  if (namespaceURI === HTML_NAMESPACE) {
    if (legacyUnknownHTMLLocalNames.has(localName)) {
      return htmlUnknownElementInterface;
    }
    if (
      knownHTMLLocalNames.has(localName) ||
      isValidCustomElementName(localName)
    ) {
      return htmlElementInterface;
    }
    return htmlUnknownElementInterface;
  }
  if (namespaceURI === SVG_NAMESPACE) return svgElementInterface;
  if (namespaceURI === MATHML_NAMESPACE) return mathMLElementInterface;
  return elementInterface;
}

const elementInterfaces = compileElementInterfaces([
  htmlHeadElementInterface,
  htmlBaseElementInterface,
  htmlLinkElementInterface,
  htmlStyleElementInterface,
  svgStyleElementInterface,
]);

function compileElementInterfaces(
  interfaces: ElementInterface[],
): ElementInterfaceRegistry {
  const namespaces = new Map<string, Map<string, ElementInterface>>();

  for (const elementInterface of interfaces) {
    let localNames = namespaces.get(elementInterface.namespaceURI);
    if (!localNames) {
      localNames = new Map();
      namespaces.set(elementInterface.namespaceURI, localNames);
    }

    for (const localName of elementInterface.localNames) {
      const existing = localNames.get(localName);
      if (existing) {
        throw new InternalError(
          `Element ${elementInterface.namespaceURI} ${localName} is declared by ` +
          `${existing.definition.name} and ${elementInterface.definition.name}`,
        );
      }
      localNames.set(localName, elementInterface);
    }
  }

  return {
    get(namespaceURI, localName) {
      return namespaces.get(namespaceURI)?.get(localName);
    },
  };
}

type ElementInterfaceRegistry = {
  get(namespaceURI: string, localName: string): ElementInterface | undefined;
};

// https://html.spec.whatwg.org/multipage/dom.html#elements-in-the-dom
// Known HTML names receive HTMLElement until their dedicated implementation
// exists; exact contributions override this fallback in the interface table.
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

const legacyUnknownHTMLLocalNames = new Set([
  'applet', 'bgsound', 'blink', 'isindex', 'keygen', 'multicol', 'nextid',
  'spacer',
]);
