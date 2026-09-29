import { HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE } from './namespaces';

export function isHtmlSvgOrMathNamespace(namespace: string | null): boolean {
  return namespace === HTML_NAMESPACE || namespace === SVG_NAMESPACE || namespace === MATHML_NAMESPACE;
}

export function isHtmlLink(element: Element): element is HTMLLinkElement {
  return element.namespaceURI === HTML_NAMESPACE && element.localName === 'link';
}

const FORM_STATE_ELEMENTS = new Set(['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']);

export function isFormStateElement(localName: string): boolean {
  return FORM_STATE_ELEMENTS.has(localName);
}
