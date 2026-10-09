import { defineInterface, type Definition } from '../../web-idl/index';
import { customElementRegistryIDL } from './custom-elements/index';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL, htmlUnknownElementIDL,
} from '../dom/nodes/html/index';
import {
  htmlHeadElementIDL, htmlBaseElementIDL, htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from '../dom/nodes/html/metadata/index';

export const htmlIDLDefinitions: Definition[] = [
  customElementRegistryIDL,
  htmlElementIDL,
  htmlElementIncludesElementCSSInlineStyleIDL,
  htmlUnknownElementIDL,
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
