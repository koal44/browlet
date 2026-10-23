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
import type { ComputedStyle } from '../../engine/index';

import { CSSDeclarationBlock } from './declaration-block';
import { InterpretedDeclaration } from './interpreted-declaration';

/** CSSOM access to authored declarations or computed values, with optional rule ownership or element write-back. */
// https://drafts.csswg.org/cssom/#the-cssstyledeclaration-interface
export class CSSStyleDeclarationImpl {
  /** Authored declarations or the computed values produced by a style query. */
  #data: CSSDeclarationBlock | ComputedStyle;
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

  /** Expose authored or computed data; hosts deliver attribute changes explicitly. */
  // https://drafts.csswg.org/cssom/#css-declaration-blocks
  constructor({
    block,
    computedStyle,
    readonly = false,
    parentRule = null,
    ownerNode = null,
  }: CSSStyleDeclarationOptions, env: StyleletEnvironment) {
    this.#env = env;
    this.#readonly = readonly;
    this.#parentRule = parentRule;
    this.#ownerNode = ownerNode;
    this.#data = computedStyle ?? block ?? new CSSDeclarationBlock();
  }

  /** Serialized declarations, or empty text for computed results; assignment replaces the block. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-csstext
  get cssText(): string {
    return this.#data instanceof CSSDeclarationBlock ? this.#data.cssText : '';
  }

  set cssText(value: string) {
    this.#mutableBlock().setText(value, {});
    this.#updateStyleAttribute();
  }

  /** Number of retained property names. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-length
  get length(): number {
    return this.#data instanceof CSSDeclarationBlock ? this.#data.declarations.length : this.#data.size;
  }

  /** Rule owning this object, or null for inline styles and computed results. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-parentrule
  get parentRule(): CSSRuleImpl | null {
    return this.#parentRule;
  }

  /** Read authored declarations; computed results contain no declaration occurrences. */
  get declarations(): readonly InterpretedDeclaration[] {
    return this.#data instanceof CSSDeclarationBlock ? this.#data.declarations : [];
  }

  /** Computed values backing this object, when it exposes a style-query result. */
  get computedStyle(): ComputedStyle | undefined {
    return this.#data instanceof CSSDeclarationBlock ? undefined : this.#data;
  }

  /** Whether CSSOM is writing the owner attribute; hosts must bypass their input policy during write-back. */
  get updating(): boolean {
    return this.#updating;
  }

  /** Property name at an index, or an empty string outside the collection. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-item
  item(index: number): string {
    return this.#data instanceof CSSDeclarationBlock ? this.#data.declarations[index]?.name ?? '' : this.#data.item(index);
  }

  /** Find a declaration by its already-normalized property name. */
  getDeclaration(name: string): InterpretedDeclaration | undefined {
    return this.#data instanceof CSSDeclarationBlock ? this.#data.find(name) : undefined;
  }

  /** Serialize a retained property's value, or return empty text when it is absent. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-getpropertyvalue
  getPropertyValue(property: string): string {
    const name = normalizePropertyName(property);
    if (!(this.#data instanceof CSSDeclarationBlock)) return this.#data.serialize(name);
    const shorthand = getShorthand(name);
    if (shorthand !== undefined) {
      const longhands = this.#data.getLonghands(shorthand);
      return longhands === null ? '' : shorthand.serialize(longhands.map(({ value }) => value));
    }
    const declaration = this.#data.find(name);
    return declaration === undefined
      ? ''
      : declaration.serializeValue();
  }

  /** Return `important` for an important declaration, otherwise an empty string. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-getpropertypriority
  getPropertyPriority(property: string): string {
    if (!(this.#data instanceof CSSDeclarationBlock)) return '';
    const name = normalizePropertyName(property);
    const shorthand = getShorthand(name);
    if (shorthand !== undefined) {
      return this.#data.getLonghands(shorthand)?.[0]?.important ? 'important' : '';
    }
    return this.#data.find(name)?.important
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
    const block = this.#mutableBlock();

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
      if (block.set(declaration)) updated = true;
    }
    if (updated) this.#updateStyleAttribute();
  }

  /** Remove a property and return its previous serialized value. */
  // https://drafts.csswg.org/cssom/#dom-cssstyledeclaration-removeproperty
  removeProperty(property: string): string {
    const block = this.#mutableBlock();

    const name = normalizePropertyName(property);
    // SPEC_CLASH(shorthand-removal-return): Follow CSSOM/Firefox by returning the
    // former shorthand value; Chromium/WebKit return empty text for shorthands.
    const value = this.getPropertyValue(name);
    const shorthand = getShorthand(name);
    let removed = false;
    if (shorthand === undefined) {
      removed = block.remove(name);
    } else {
      for (const { name: longhand } of shorthand.longhands) {
        if (block.remove(longhand)) removed = true;
      }
    }
    if (removed) this.#updateStyleAttribute();
    return value;
  }

  /** Iterate a snapshot of the retained property names in collection order. */
  [Symbol.iterator](): ArrayIterator<string> {
    const names = this.#data instanceof CSSDeclarationBlock
      ? this.#data.declarations.map(({ name }) => name) : [...this.#data.keys()];
    return names[Symbol.iterator]();
  }

  /** Apply an initial or changed attribute value without writing it back to the owner. */
  attributeChanged(
    localName: string,
    value: string | null,
    namespace: string | null = null,
  ): void {
    if (!(this.#data instanceof CSSDeclarationBlock) || this.#updating) return;
    if (localName !== 'style' || namespace !== null) return;

    this.#data.setText(value ?? '', {});
  }

  /** Read current indices from either source; changes need no synchronization. */
  *getSupportedPropertyIndices(): Iterable<number> {
    for (let index = 0, length = this.length; index < length; index++) yield index;
  }

  /** Write declarations to the owner attribute while suppressing the resulting input echo. */
  // https://drafts.csswg.org/cssom/#update-style-attribute-for
  #updateStyleAttribute(): void {
    if (this.#ownerNode === null || !(this.#data instanceof CSSDeclarationBlock)) return;

    this.#updating = true;
    try {
      this.#env.userAgent.dom.setAttributeNS(this.#ownerNode, null, 'style', this.cssText);
    } finally {
      this.#updating = false;
    }
  }

  /** Obtain the authored block, rejecting CSSOM writes to computed or read-only data. */
  #mutableBlock(): CSSDeclarationBlock {
    if (!this.#readonly && this.#data instanceof CSSDeclarationBlock) return this.#data;

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
  /** Computed results to expose instead of authored declarations. */
  computedStyle?: ComputedStyle;
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
