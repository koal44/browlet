import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from '../shared/namespaces';
import {
  elementInterface, type ElementInterface,
} from './dom/nodes/element';
import { isValidCustomElementName } from './html/custom-elements/names';
import { htmlElementInterface } from './html/elements/html-element';
import { htmlUnknownElementInterface } from './html/elements/html-unknown-element';
import { htmlHeadElementInterface } from './html/elements/metadata/head';
import { htmlLinkElementInterface } from './html/elements/metadata/link';
import { htmlStyleElementInterface } from './html/elements/metadata/style';
import { mathMLElementInterface } from './mathml/element';
import { svgElementInterface } from './svg/element';
import { svgStyleElementInterface } from './svg/style-element';

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
  htmlLinkElementInterface,
  htmlStyleElementInterface,
  svgStyleElementInterface,
]);

function compileElementInterfaces(
  interfaces: readonly ElementInterface[],
): ElementInterfaceRegistry {
  const namespaces = new Map<string, Map<string, ElementInterface>>();

  for (const interface_ of interfaces) {
    let localNames = namespaces.get(interface_.namespaceURI);
    if (!localNames) {
      localNames = new Map();
      namespaces.set(interface_.namespaceURI, localNames);
    }

    for (const localName of interface_.localNames) {
      const existing = localNames.get(localName);
      if (existing) {
        throw new TypeError(
          `Element ${interface_.namespaceURI} ${localName} is declared by ` +
          `${existing.definition.name} and ${interface_.definition.name}`,
        );
      }
      localNames.set(localName, interface_);
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

/*
 * HTML's element-interface algorithm distinguishes known HTML names from
 * names that receive HTMLUnknownElement. Until each known element has its
 * dedicated interface, Browlet deliberately gives it the generic HTMLElement
 * implementation. Exact implemented-interface contributions override this
 * set in the compiled element-interface table.
 */
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
