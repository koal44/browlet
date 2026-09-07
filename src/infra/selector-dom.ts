import {
  HTML_NAMESPACE, MATHML_NAMESPACE, SVG_NAMESPACE,
} from './index';

// Selector guards for DOM objects supplied by the host.

const ELEMENT_NODE = 1;
const DOCUMENT_FRAGMENT_NODE = 11;

export function isElement(n: Node): n is Element {
  return n.nodeType === ELEMENT_NODE;
}

export function isHtmlElement(e: Element): e is HTMLElement {
  return e.namespaceURI === HTML_NAMESPACE;
}

export function isSvgElement(e: Element): e is SVGElement {
  return e.namespaceURI === SVG_NAMESPACE;
}

export function isMathElement(e: Element): e is MathMLElement {
  return e.namespaceURI === MATHML_NAMESPACE;
}

export function isHtmlSvgOrMathElement(e: Element): e is HTMLElement | SVGElement | MathMLElement {
  return isHtmlElement(e) || isSvgElement(e) || isMathElement(e);
}

export function isHtmlMediaElement(e: Element): e is HTMLMediaElement {
  return 'currentTime' in e && 'paused' in e && 'ended' in e && 'readyState' in e;
}

export function isIFrame(e: Element): e is HTMLIFrameElement {
  return e.localName === 'iframe';
}

export function isHtmlInput(e: Element): e is HTMLInputElement {
  return e.localName === 'input';
}

export function isHtmlButton(e: Element): e is HTMLButtonElement {
  return e.localName === 'button';
}

export type FormStateElement = HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLOptGroupElement | HTMLOptionElement | HTMLSelectElement | HTMLTextAreaElement;
const FORM_STATE_ELEMENTS = new Set(['button', 'fieldset', 'input', 'optgroup', 'option', 'select', 'textarea']);
export function isFormStateElement(e: Element): e is FormStateElement {
  return FORM_STATE_ELEMENTS.has(e.localName);
}

export function isHtmlTextArea(e: Element): e is HTMLTextAreaElement {
  return e.localName === 'textarea';
}

export function isHtmlFieldSet(e: Element): e is HTMLFieldSetElement {
  return e.localName === 'fieldset';
}

export function isHtmlLegend(e: Element): e is HTMLLegendElement {
  return e.localName === 'legend';
}

export function isHtmlOptGroup(e: Element): e is HTMLOptGroupElement {
  return e.localName === 'optgroup';
}

export function isHtmlOption(e: Element): e is HTMLOptionElement {
  return e.localName === 'option';
}

export function isHtmlProgress(e: Element): e is HTMLProgressElement {
  return e.localName === 'progress';
}

export function isHtmlSelect(e: Element): e is HTMLSelectElement {
  return e.localName === 'select';
}

export function isHtmlForm(e: Element): e is HTMLFormElement {
  return e.localName === 'form';
}

export type ValidityElement =
  HTMLButtonElement | HTMLFieldSetElement | HTMLInputElement | HTMLObjectElement
  | HTMLOutputElement | HTMLSelectElement | HTMLTextAreaElement;

export function isValidityElement(e: Element): e is ValidityElement {
  return 'willValidate' in e;
}

export function isShadowRoot(n: Node): n is ShadowRoot {
  return n.nodeType === DOCUMENT_FRAGMENT_NODE &&
    'host' in n &&
    isElement((n as ShadowRoot).host);
}

// Returns the node's root if that root is a ShadowRoot.
export function getShadowTreeRoot(n: Node): ShadowRoot | null {
  const root = n.getRootNode();
  return isShadowRoot(root) ? root : null;
}
