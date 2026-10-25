import { HTML_NAMESPACE, SVG_NAMESPACE, XLINK_NAMESPACE, isHtmlSvgOrMathNamespace } from '../../../../infra/index';

import type { TrustedTypeName } from './value';

/** Required type and sink name; callers must not mutate shared lookup results. */
export type TrustedTypeAttributeData = { readonly type: TrustedTypeName; readonly sink: string; };

/** Match local names and namespaces without depending on concrete element constructors. */
// https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-data-for-attribute
// Return only the required type and sink from the matched specification table row.
export function getTrustedTypeDataForAttribute(
  localName: string, elementNs: string | null, attribute: string, attributeNs: string | null,
): TrustedTypeAttributeData | null {
  if (attributeNs === null) {
    if (isHtmlSvgOrMathNamespace(elementNs) && eventHandlerContentAttributes.has(attribute)) {
      return { type: 'TrustedScript', sink: `Element ${attribute}` };
    }
    if (elementNs === HTML_NAMESPACE) {
      if (localName === 'iframe' && attribute === 'srcdoc') {
        return iframeSrcdocData;
      }
      if (localName === 'script' && attribute === 'src') {
        return htmlScriptSrcData;
      }
    }
  }
  if (elementNs === SVG_NAMESPACE && localName === 'script' && attribute === 'href' &&
    (attributeNs === null || attributeNs === XLINK_NAMESPACE)) {
    return svgScriptHrefData;
  }
  return null;
}

const iframeSrcdocData: TrustedTypeAttributeData = { type: 'TrustedHTML', sink: 'HTMLIFrameElement srcdoc' };
const htmlScriptSrcData: TrustedTypeAttributeData = { type: 'TrustedScriptURL', sink: 'HTMLScriptElement src' };
const svgScriptHrefData: TrustedTypeAttributeData = { type: 'TrustedScriptURL', sink: 'SVGScriptElement href' };

// SPEC_GAP(trusted-types-event-handler-attributes): The draft does not enumerate content handlers.
// Use standard element content handlers, including Window handlers exposed on body/frameset,
// rather than all on* names or arbitrary event-target IDL attributes. See ROADMAP.md and TT #520.
const eventHandlerContentAttributes = new Set([
  // HTML's GlobalEventHandlers and WindowEventHandlers.
  // https://html.spec.whatwg.org/multipage/webappapis.html#event-handlers
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
  'onwebkitanimationend', 'onwebkitanimationiteration', 'onwebkitanimationstart', 'onwebkittransitionend', 'onwheel',
  'onafterprint', 'onbeforeprint', 'onbeforeunload', 'onhashchange', 'onlanguagechange', 'onmessage',
  'onmessageerror', 'onoffline', 'ononline', 'onpagehide', 'onpagereveal', 'onpageshow', 'onpageswap',
  'onpopstate', 'onrejectionhandled', 'onstorage', 'onunhandledrejection', 'onunload',
  // Standard contributions to GlobalEventHandlers from Pointer/Touch Events, CSS, and Selection.
  // https://w3c.github.io/pointerevents/#extensions-to-the-globaleventhandlers-mixin
  // https://w3c.github.io/touch-events/#extensions-to-the-globaleventhandlers-mixin
  // https://drafts.csswg.org/css-animations-1/#interface-globaleventhandlers
  // https://drafts.csswg.org/css-transitions-1/#interface-globaleventhandlers
  // https://drafts.csswg.org/css-contain-2/#content-visibility-auto-state-change
  // https://drafts.csswg.org/css-scroll-snap-2/#snap-events
  // https://w3c.github.io/selection-api/#extensions-to-globaleventhandlers
  'ongotpointercapture', 'onlostpointercapture', 'onpointerdown', 'onpointermove', 'onpointerrawupdate',
  'onpointerup', 'onpointercancel', 'onpointerover', 'onpointerout', 'onpointerenter', 'onpointerleave',
  'ontouchstart', 'ontouchend', 'ontouchmove', 'ontouchcancel',
  'onanimationstart', 'onanimationiteration', 'onanimationend', 'onanimationcancel',
  'ontransitionrun', 'ontransitionstart', 'ontransitionend', 'ontransitioncancel',
  'oncontentvisibilityautostatechange', 'onscrollsnapchange', 'onscrollsnapchanging', 'onselectstart', 'onselectionchange',
  // HTMLMediaElement (Encrypted Media) and SVGAnimationElement content handlers.
  // https://w3c.github.io/encrypted-media/#extensions-to-the-htmlmediaelement-interface
  // https://svgwg.org/specs/animations/#InterfaceSVGAnimationElement
  'onencrypted', 'onwaitingforkey', 'onbegin', 'onend', 'onrepeat',
]);
