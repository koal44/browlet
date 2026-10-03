import { defineInterface, type Definition } from '../../web-idl/index';
import { customElementRegistryIDL } from './custom-elements/registry';
import {
  htmlElementIDL, htmlElementIncludesElementCSSInlineStyleIDL,
} from './elements/html-element';
import { htmlUnknownElementIDL } from './elements/html-unknown-element';
import { htmlHeadElementIDL } from './elements/metadata/head';
import { htmlBaseElementIDL } from './elements/metadata/base';
import {
  htmlLinkElementIDL, htmlLinkElementIncludesLinkStyleIDL,
} from './elements/metadata/link';
import {
  htmlStyleElementIDL, htmlStyleElementIncludesLinkStyleIDL,
} from './elements/metadata/style';

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
