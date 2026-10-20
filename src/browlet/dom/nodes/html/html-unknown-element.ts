import { HTML_NAMESPACE } from '../../../../infra/index';
import { defineInterface, impl } from '../../../../web-idl/core/index';

import { ElementTag } from '../element-definitions/index';

import { HTMLElementImpl } from './html-element';

/** Represents an unrecognized HTML element name. */
// https://html.spec.whatwg.org/multipage/dom.html#htmlunknownelement
export class HTMLUnknownElementImpl extends HTMLElementImpl {
  static is(value: unknown): value is HTMLUnknownElementImpl {
    return value instanceof HTMLUnknownElementImpl;
  }
}

/** The applet element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLAppletElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'applet';
  static {
    this.prototype.tag = ElementTag.HTMLApplet;
  }
}

/** The bgsound element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLBGSoundElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'bgsound';
  static {
    this.prototype.tag = ElementTag.HTMLBgsound;
  }
}

/** The blink element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLBlinkElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'blink';
  static {
    this.prototype.tag = ElementTag.HTMLBlink;
  }
}

/** The isindex element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLIsIndexElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'isindex';
  static {
    this.prototype.tag = ElementTag.HTMLIsindex;
  }
}

/** The keygen element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLKeygenElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'keygen';
  static {
    this.prototype.tag = ElementTag.HTMLKeygen;
  }
}

/** The multicol element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLMultiColElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'multicol';
  static {
    this.prototype.tag = ElementTag.HTMLMulticol;
  }
}

/** The nextid element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLNextIDElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'nextid';
  static {
    this.prototype.tag = ElementTag.HTMLNextid;
  }
}

/** The spacer element, exposed through HTMLUnknownElement. */
// https://html.spec.whatwg.org/multipage/obsolete.html#other-elements,-attributes-and-apis
export class HTMLSpacerElementImpl extends HTMLUnknownElementImpl {
  static override localName = 'spacer';
  static {
    this.prototype.tag = ElementTag.HTMLSpacer;
  }
}

/*
 * [Exposed=Window]
 * interface HTMLUnknownElement : HTMLElement {
 *   // Note: intentionally no [HTMLConstructor]
 * };
 */
export const htmlUnknownElementIDL = defineInterface({
  name: 'HTMLUnknownElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: [
    impl(HTMLUnknownElementImpl),
    impl(HTMLAppletElementImpl),
    impl(HTMLBGSoundElementImpl),
    impl(HTMLBlinkElementImpl),
    impl(HTMLIsIndexElementImpl),
    impl(HTMLKeygenElementImpl),
    impl(HTMLMultiColElementImpl),
    impl(HTMLNextIDElementImpl),
    impl(HTMLSpacerElementImpl),
  ],
  namespaceURI: HTML_NAMESPACE,
  members: [],
});
