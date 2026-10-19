import { isValidAttributeLocalName } from '../../../infra/index';

/**
 * Recognize HTML's namespace-less global names, including custom data attributes.
 * HTML element callers handle document-dependent names and unfinished attribute families separately.
 * Permission to specify a name does not validate its value or implement its behavior.
 */
// https://html.spec.whatwg.org/multipage/dom.html#global-attributes
// https://html.spec.whatwg.org/multipage/webappapis.html#handler-onabort
export function isGlobalContentAttribute(name: string): boolean {
  return globalContentAttributes.has(name) || isCustomDataAttributeName(name);
}

/** Check the custom-data name grammar, preserving non-ASCII case and requiring a nonempty suffix. */
// https://html.spec.whatwg.org/multipage/dom.html#custom-data-attribute
function isCustomDataAttributeName(name: string): boolean {
  return name.startsWith('data-') && name.length > 5 && !/[A-Z]/.test(name) && isValidAttributeLocalName(name);
}

const globalContentAttributes = new Set([
  'accesskey', 'autocapitalize', 'autocorrect', 'autofocus', 'contenteditable', 'dir', 'draggable',
  'enterkeyhint', 'headingoffset', 'headingreset', 'hidden', 'inert', 'inputmode', 'is', 'itemid',
  'itemprop', 'itemref', 'itemscope', 'itemtype', 'lang', 'nonce', 'popover', 'spellcheck', 'style',
  'tabindex', 'title', 'translate', 'writingsuggestions',

  // DOM defines these for elements in every namespace; HTML permits them on every HTML element.
  'class', 'id', 'slot',

  // HTML's preamble and §8.1 define these global names. Execution and body/Window targeting remain §8.1 work.
  // Trusted Types' sink inventory is broader: it also includes element-specific and other-spec handlers.
  'onabort', 'onauxclick', 'onbeforeinput', 'onbeforematch', 'onbeforetoggle', 'onblur', 'oncancel',
  'oncanplay', 'oncanplaythrough', 'onchange', 'onclick', 'onclose', 'oncommand', 'oncontextlost',
  'oncontextmenu', 'oncontextrestored', 'oncopy', 'oncuechange', 'oncut', 'ondblclick', 'ondrag',
  'ondragend', 'ondragenter', 'ondragleave', 'ondragover', 'ondragstart', 'ondrop', 'ondurationchange',
  'onemptied', 'onended', 'onerror', 'onfocus', 'onformdata', 'oninput', 'oninvalid', 'onkeydown',
  'onkeypress', 'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata', 'onloadstart', 'onmousedown',
  'onmouseenter', 'onmouseleave', 'onmousemove', 'onmouseout', 'onmouseover', 'onmouseup', 'onpaste',
  'onpause', 'onplay', 'onplaying', 'onprogress', 'onratechange', 'onreset', 'onresize', 'onscroll',
  'onscrollend', 'onsecuritypolicyviolation', 'onseeked', 'onseeking', 'onselect', 'onslotchange',
  'onstalled', 'onsubmit', 'onsuspend', 'ontimeupdate', 'ontoggle', 'onvolumechange', 'onwaiting',
  'onwebkitanimationend', 'onwebkitanimationiteration', 'onwebkitanimationstart', 'onwebkittransitionend',
  'onwheel',
]);
