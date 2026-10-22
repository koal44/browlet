import type { DOMElement as Element } from '../../../infra/index';
import { asciiLower } from '../../../infra/ascii';
import {
  annotated, arg, attr, defineInterface, DOMExceptionImpl, idlType, impl, indexedGetter, nullable, op,
  reference, roAttr, xattr,
} from '../../../web-idl/core/index';

import type { StyleletEnvironment } from '../../environment';
import { isCustomPropertyName } from '../../syntax/index';
import { getShorthand, propertyRegistry } from '../../props/index';
import type { CSSRuleImpl } from '../rules/index';

import { CSSDeclarationBlock } from './declaration-block';
import { InterpretedDeclaration } from './interpreted-declaration';

/** CSSOM access to a declaration block, with optional rule ownership or element write-back. */
// https://drafts.csswg.org/cssom/#the-cssstyledeclaration-interface
export class CSSStyleDeclarationImpl {
  /** Parsed declarations shared with the owning rule, inline style, or computed result. */
  #block: CSSDeclarationBlock;
  /** Whether this object represents a computed result rather than authored declarations. */
  #computed: boolean;
  /** Whether CSSOM mutation operations must reject changes to the block. */
  #readonly: boolean;
  /** Rule whose declarations this object exposes, or null outside a rule. */
  #parentRule: CSSRuleImpl | null;
  /** Element whose style attribute receives CSSOM writes, or null without attribute ownership. */
  #ownerNode: Element | null;
  /** Whether an attribute notification is the echo of this object's own write-back. */
  #updating = false;
  /** Owning environment used to write the element's style attribute. */
  #env: StyleletEnvironment;

  /** Expose a declaration block; hosts deliver attribute changes explicitly. */
  // https://drafts.csswg.org/cssom/#css-declaration-blocks
  constructor({
    block = new CSSDeclarationBlock(),
    computed = false,
    readonly = false,
    parentRule = null,
    ownerNode = null,
  }: CSSStyleDeclarationOptions, env: StyleletEnvironment) {
    this.#env = env;
    this.#computed = computed;
    this.#readonly = readonly;
    this.#parentRule = parentRule;
    this.#ownerNode = ownerNode;
    this.#block = block;
  }

  /** Serialized declarations, or empty text for computed results; assignment replaces the block. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-csstext
  get cssText(): string {
    return this.#computed ? '' : this.#block.cssText;
  }

  set cssText(value: string) {
    this.#assertMutable();
    this.#block.setText(value, {});
    this.#updateStyleAttribute();
  }

  /** Number of property declarations currently retained by the block. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-length
  get length(): number {
    return this.#block.declarations.length;
  }

  /** Rule owning this declaration object, or null for inline/computed declarations. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-parentrule
  get parentRule(): CSSRuleImpl | null {
    return this.#parentRule;
  }

  /** Read the current parsed declarations without serializing or projecting them. */
  get declarations(): readonly InterpretedDeclaration[] {
    return this.#block.declarations;
  }

  /** Whether CSSOM is writing the owner attribute; hosts must bypass their input policy during write-back. */
  get updating(): boolean {
    return this.#updating;
  }

  /** Property name at an index, or an empty string outside the block. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-item
  item(index: number): string {
    return this.#block.declarations[index]?.name ?? '';
  }

  /** Find a declaration by its already-normalized property name. */
  getDeclaration(name: string): InterpretedDeclaration | undefined {
    return this.#block.find(name);
  }

  /** Serialize a retained property's value, or return empty text when it is absent. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-getpropertyvalue
  getPropertyValue(property: string): string {
    const name = normalizePropertyName(property);
    const shorthand = getShorthand(name);
    if (shorthand !== undefined) {
      const longhands = this.#block.getLonghands(shorthand);
      return longhands === null ? '' : shorthand.serialize(longhands.map(({ value }) => value));
    }
    const declaration = this.#block.find(name);
    return declaration === undefined
      ? ''
      : declaration.serializeValue();
  }

  /** Return `important` for an important declaration, otherwise an empty string. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-getpropertypriority
  getPropertyPriority(property: string): string {
    const name = normalizePropertyName(property);
    const shorthand = getShorthand(name);
    if (shorthand !== undefined) {
      return this.#block.getLonghands(shorthand)?.[0]?.important ? 'important' : '';
    }
    return this.#block.find(name)?.important
      ? 'important'
      : '';
  }

  /** Set a supported property, ignoring invalid input; an empty value removes it. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-setproperty
  setProperty(
    property: string,
    value: string,
    priority = '',
  ): void {
    this.#assertMutable();

    const name = normalizePropertyName(property);
    if (!isCustomPropertyName(name) && !isSupportedPropertyName(name) && getShorthand(name) === undefined) return;

    // SPEC_CLASH(empty-value-priority-order): Follow CSSOM/Firefox by removing
    // an empty value before checking priority; Chromium/WebKit check priority first.
    if (value === '') {
      this.removeProperty(name);
      return;
    }

    if (priority !== '' && asciiLower(priority) !== 'important') return;

    const declarations = InterpretedDeclaration.parse(
      name,
      value,
      priority !== '',
      {},
    );
    if (declarations === null) return;
    let updated = false;
    for (const declaration of declarations) {
      if (this.#block.set(declaration)) updated = true;
    }
    if (updated) this.#updateStyleAttribute();
  }

  /** Remove a property and return its previous serialized value. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-removeproperty
  removeProperty(property: string): string {
    this.#assertMutable();

    const name = normalizePropertyName(property);
    // SPEC_CLASH(shorthand-removal-return): Follow CSSOM/Firefox by returning the
    // former shorthand value; Chromium/WebKit return empty text for shorthands.
    const value = this.getPropertyValue(name);
    const shorthand = getShorthand(name);
    let removed = false;
    if (shorthand === undefined) {
      removed = this.#block.remove(name);
    } else {
      for (const [longhand] of shorthand.longhands) {
        if (this.#block.remove(longhand)) removed = true;
      }
    }
    if (removed) this.#updateStyleAttribute();
    return value;
  }

  /** Iterate a snapshot of the block's property names in declaration order. */
  [Symbol.iterator](): ArrayIterator<string> {
    return this.#block.declarations.map(({ name }) => name)[Symbol.iterator]();
  }

  /** Apply an initial or changed attribute value without writing it back to the owner. */
  attributeChanged(
    localName: string,
    value: string | null,
    namespace: string | null = null,
  ): void {
    if (this.#computed || this.#updating) return;
    if (localName !== 'style' || namespace !== null) return;

    this.#block.setText(value ?? '', {});
  }

  /** Read the shared block's current indices; attribute changes need no synchronization. */
  getSupportedPropertyIndices(): Iterable<number> {
    return this.#block.declarations.keys();
  }

  /** Write declarations to the owner attribute while suppressing the resulting input echo. */
  // https://drafts.csswg.org/cssom/#update-style-attribute-for
  #updateStyleAttribute(): void {
    if (this.#ownerNode === null || this.#computed) return;

    this.#updating = true;
    try {
      this.#env.userAgent.dom.setAttributeNS(this.#ownerNode, null, 'style', this.cssText);
    } finally {
      this.#updating = false;
    }
  }

  /** Reject CSSOM writes when the declaration block is read-only. */
  #assertMutable(): void {
    if (!this.#readonly) return;

    throw new DOMExceptionImpl(
      'The CSS declaration block is read-only.',
      'NoModificationAllowedError',
    );
  }
}

/** Declaration state and associations supplied by the owning rule, element, or style query. */
type CSSStyleDeclarationOptions = {
  /** Existing declaration data to expose; omitted creates an empty block. */
  block?: CSSDeclarationBlock;
  /** Whether reads use the computed-declaration rules. */
  computed?: boolean;
  /** Whether author mutation operations must throw. */
  readonly?: boolean;
  /** Rule whose declarations this object represents, or null when there is no owning rule. */
  parentRule?: CSSRuleImpl | null;
  /** Attribute write-back target; attaching an owner does not read its current attribute. */
  ownerNode?: Element | null;
};

/** Canonicalize a built-in property name while preserving custom-property case. */
function normalizePropertyName(name: string): string {
  return isCustomPropertyName(name) ? name : asciiLower(name);
}

/** Whether the built-in property registry supplies this property's grammar and metadata. */
function isSupportedPropertyName(
  name: string,
): name is keyof typeof propertyRegistry {
  return Object.hasOwn(propertyRegistry, name);
}

/*
 * [Exposed=Window]
 * interface CSSStyleDeclaration {
 *   [CEReactions] attribute CSSOMString cssText;
 *   readonly attribute unsigned long length;
 *   getter CSSOMString item(unsigned long index);
 *   CSSOMString getPropertyValue(CSSOMString property);
 *   CSSOMString getPropertyPriority(CSSOMString property);
 *   [CEReactions] undefined setProperty(
 *     CSSOMString property,
 *     [LegacyNullToEmptyString] CSSOMString value,
 *     optional [LegacyNullToEmptyString] CSSOMString priority = ""
 *   );
 *   [CEReactions] CSSOMString removeProperty(CSSOMString property);
 *   readonly attribute CSSRule? parentRule;
 * };
 */
export const cssStyleDeclarationIDL = defineInterface({
  name: 'CSSStyleDeclaration',
  exposed: 'Window',
  implementation: impl(CSSStyleDeclarationImpl),
  members: [
    attr('cssText', reference('CSSOMString'), xattr('CEReactions')),
    roAttr('length', idlType.unsignedLong),
    op('item', reference('CSSOMString'),
      [arg('index', idlType.unsignedLong)],
      // SPEC_CLASH(css-declaration-indexed-write): Follow Web IDL/Firefox/WebKit:
      // indexed writes fail without an indexed setter; Chromium reports success.
      indexedGetter((style: CSSStyleDeclarationImpl) => style.getSupportedPropertyIndices(), {
        supportsIndex: (style, index) => index < style.length,
      }),
    ),
    op('getPropertyValue', reference('CSSOMString'), [arg('property', reference('CSSOMString'))]),
    op('getPropertyPriority', reference('CSSOMString'), [arg('property', reference('CSSOMString'))]),
    op('setProperty', idlType.undefined,
      [
        arg('property', reference('CSSOMString')),
        arg('value', annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString'))),
        arg('priority', annotated(reference('CSSOMString'), xattr('LegacyNullToEmptyString')), { optional: true, default: '' }),
      ],
      xattr('CEReactions'),
    ),
    op('removeProperty', reference('CSSOMString'),
      [arg('property', reference('CSSOMString'))],
      xattr('CEReactions'),
    ),
    roAttr('parentRule', nullable(reference('CSSRule'))),
  ],
});
