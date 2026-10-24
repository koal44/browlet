import { asciiUpper } from '../../../infra/ascii';
import {
  annotated, attr, defineInterface, impl, reference, xattr,
  type AttributeMember,
} from '../../../web-idl/core/index';

import { propertyRegistry } from '../../props/index';

import { CSSStyleDeclarationImpl } from './style-declaration';

/** A declaration object whose supported CSS properties are exposed as attributes by Binding. */
// https://drafts.csswg.org/cssom/#cssstyleproperties
// SPEC_CLASH(css-property-attribute-placement): Follow Web IDL/Firefox/WebKit:
// property attributes live on the prototype. Chromium exposes own attributes.
export class CSSStylePropertiesImpl extends CSSStyleDeclarationImpl {}

/*
 * [Exposed=Window]
 * interface CSSStyleProperties : CSSStyleDeclaration {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString cssFloat;
 * };
 *
 * // Per-supported-property fragments; the attribute names below are placeholders.
 * partial interface CSSStyleProperties {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString _camel_cased_attribute;
 * };
 * partial interface CSSStyleProperties {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString _webkit_cased_attribute;
 * };
 * partial interface CSSStyleProperties {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString _dashed_attribute;
 * };
 */
export const cssStylePropertiesIDL = defineInterface({
  name: 'CSSStyleProperties',
  inherits: 'CSSStyleDeclaration',
  exposed: 'Window',
  implementation: impl(CSSStylePropertiesImpl),
  members: createPropertyAttributes(),
});

/** Build Web IDL attributes for supported CSS properties using the declaration's existing read/write operations. */
// https://drafts.csswg.org/cssom/#dom-cssstyleproperties-camel-cased-attribute
// https://drafts.csswg.org/cssom/#dom-cssstyleproperties-webkit-cased-attribute
// https://drafts.csswg.org/cssom/#dom-cssstyleproperties-dashed-attribute
function createPropertyAttributes(): AttributeMember[] {
  const attributes: [attribute: string, property: string][] = [['cssFloat', 'float']];
  for (const property of Object.keys(propertyRegistry)) {
    const attribute = cssPropertyToIDLAttribute(property);
    attributes.push([attribute, property]);
    if (property.startsWith('-webkit-')) attributes.push([cssPropertyToIDLAttribute(property, true), property]);
    if (attribute !== property) attributes.push([property, property]);
  }

  // Each attribute retains the original CSS property instead of reversing its
  // spelling on every access (IDL attribute to CSS property).
  return attributes.map(([attribute, property]) => {
    return attr(attribute, annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString')), {
      ...xattr('CEReactions'),
      get() {
        return (this as CSSStylePropertiesImpl).getPropertyValue(property);
      },
      set(_env, value) {
        (this as CSSStylePropertiesImpl).setProperty(property, value as string);
      },
    });
  });
}

/** Convert a CSS property name to its ordinary or lower-initial WebKit IDL attribute. */
// https://drafts.csswg.org/cssom/#css-property-to-idl-attribute
function cssPropertyToIDLAttribute(property: string, lowercaseFirst = false): string {
  let attribute = '';
  let uppercaseNext = false;
  const input = lowercaseFirst ? property.slice(1) : property;
  for (const character of input) {
    if (character === '-') {
      uppercaseNext = true;
    } else {
      attribute += uppercaseNext ? asciiUpper(character) : character;
      uppercaseNext = false;
    }
  }
  return attribute;
}
