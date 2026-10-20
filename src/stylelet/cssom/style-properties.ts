import {
  annotated, attr, defineInterface, impl, reference, xattr,
  type AttributeMember,
} from '../../web-idl/core/index';

import { propertyRegistry } from '../css/index';

import { CSSStyleDeclarationImpl } from './declaration';

/** A property declaration exposes the supported property names through its host binding. */
/*
 * [Exposed=Window]
 * interface CSSStyleProperties : CSSStyleDeclaration {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString cssFloat;
 * };
 */
export class CSSStylePropertiesImpl extends CSSStyleDeclarationImpl {}

// https://drafts.csswg.org/cssom/#the-cssstyleproperties-interface
export const cssStylePropertiesIDL = defineInterface({
  name: 'CSSStyleProperties',
  inherits: 'CSSStyleDeclaration',
  exposed: 'Window',
  implementation: impl(CSSStylePropertiesImpl),
  members: propertyAttributes(),
});

/** Declare supported CSS properties using the declaration's existing read/write operations. */
function propertyAttributes(): AttributeMember[] {
  const members = [propertyAttribute('cssFloat', 'float')];
  for (const property of Object.keys(propertyRegistry)) {
    // https://drafts.csswg.org/cssom/#css-property-to-idl-attribute
    const attribute = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    members.push(propertyAttribute(attribute, property));
    if (attribute !== property) members.push(propertyAttribute(property, property));
  }
  return members;
}

/** Build one property attribute with CSSOM's null conversion and reaction boundary. */
function propertyAttribute(attribute: string, property: string): AttributeMember {
  return attr(attribute, annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString')), {
    ...xattr('CEReactions'),
    get() {
      return (this as CSSStylePropertiesImpl).getPropertyValue(property);
    },
    set(_env, value) {
      (this as CSSStylePropertiesImpl).setProperty(property, value as string);
    },
  });
}
