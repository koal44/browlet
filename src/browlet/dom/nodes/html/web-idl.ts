import { defineInterface, type Definition } from '../../../../web-idl/index';

import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
} from './html-element';
import { htmlUnknownElementIDL } from './html-unknown-element';
import { htmlScriptElementIDL } from './script';
import { assignedNodesOptionsIDL, htmlSlotElementIDL } from './slot';
import {
  htmlHeadElementIDL, htmlBaseElementIDL, htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from './metadata/index';
import { customElementRegistryIDL } from './custom-elements/index';

export const htmlIDLDefinitions: Definition[] = [
  customElementRegistryIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlUnknownElementIDL,
  htmlScriptElementIDL,
  htmlSlotElementIDL,
  assignedNodesOptionsIDL,
  htmlHeadElementIDL,
  htmlBaseElementIDL,
  htmlStyleElementIDL,
  htmlStyleElementIncludesLinkStyleIDL,
  htmlLinkElementIDL,
  htmlLinkElementIncludesLinkStyleIDL,
  // FormData references this type before form behavior or Window exposure exists.
  // TODO: Move the declaration into forms/form.ts when implementing HTML forms.
  // https://html.spec.whatwg.org/multipage/forms.html#htmlformelement
  defineInterface({ name: 'HTMLFormElement', inherits: 'HTMLElement', members: [] }),
];
