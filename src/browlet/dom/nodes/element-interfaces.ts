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
// https://html.spec.whatwg.org/multipage/dom.html#elements-in-the-dom
export function getElementConstructor(
  namespaceURI: string,
  localName: string,
): typeof ElementImpl {
  const exact = elementConstructors.get(namespaceURI)?.get(localName);
  if (exact) return exact;

  if (namespaceURI === HTML_NAMESPACE) {
    return isValidCustomElementName(localName) ? HTMLElementImpl : HTMLUnknownElementImpl;
  }
  if (namespaceURI === SVG_NAMESPACE) return SVGElementImpl;
  if (namespaceURI === MATHML_NAMESPACE) return MathMLElementImpl;
  return ElementImpl;
}

const elementConstructors = collectElementConstructors();

function collectElementConstructors(): Map<string, Map<string, typeof ElementImpl>> {
  const namespaces = new Map<string, Map<string, typeof ElementImpl>>();

  for (const definition of [...htmlIDLDefinitions, ...svgIDLDefinitions, ...mathMLIDLDefinitions]) {
    if (definition.kind !== 'interface' || definition.namespaceURI === undefined) continue;
    // Declaration tests require a namespace, an Element implementation, and unique names.
    const namespaceURI = definition.namespaceURI;
    const declared = definition.implementation!;
    const implementations = Array.isArray(declared) ? declared : [declared];
    let localNames = namespaces.get(namespaceURI);
    if (!localNames) {
      localNames = new Map();
      namespaces.set(namespaceURI, localNames);
    }
    for (const implementation of implementations) {
      const constructor = implementation.implClass as typeof ElementImpl;
      if (constructor.localName !== undefined) localNames.set(constructor.localName, constructor);
      for (const localName of definition.localNames ?? []) {
        localNames.set(localName, constructor);
      }
    }
  }

  return namespaces;
}
