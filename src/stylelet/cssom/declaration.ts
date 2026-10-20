import type { DOMElement as Element } from '../../infra/index';
import { asciiLower } from '../../infra/ascii';
import {
  annotated, arg, attr, defineInterface, DOMExceptionImpl, idlType, impl, indexedGetter, nullable, op,
  reference, roAttr, xattr,
} from '../../web-idl/core/index';

import type { StyleletEnvironment } from '../environment';
import { parseDeclaration } from '../syntax/index';
import {
  interpretPropertyDeclaration, propertyRegistry, serializePropertyDeclaration, CSSDeclarationBlock,
  type PropertyDeclaration, type PropertyContext,
} from '../css/index';

import type { CSSRuleImpl } from './rule';

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
export class CSSStyleDeclarationImpl {
  #block: CSSDeclarationBlock;
  #computed: boolean;
  #readonly: boolean;
  #parentRule: CSSRuleImpl | null;
  #ownerNode: Element | null;
  #updating = false;
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

  get cssText(): string {
    return this.#computed ? '' : this.#block.cssText;
  }

  set cssText(value: string) {
    this.#assertMutable();
    this.#block.setText(value, {});
    this.#commit();
  }

  get length(): number {
    return this.#block.declarations.length;
  }

  get parentRule(): CSSRuleImpl | null {
    return this.#parentRule;
  }

  /** Read the current parsed declarations without serializing or projecting them. */
  get declarations(): readonly PropertyDeclaration[] {
    return this.#block.declarations;
  }

  /** Whether CSSOM is writing the owner attribute; hosts must bypass their input policy during write-back. */
  get updating(): boolean {
    return this.#updating;
  }

  item(index: number): string {
    return this.#block.declarations[index]?.name ?? '';
  }

  /** Find a declaration by its already-normalized property name. */
  getDeclaration(name: string): PropertyDeclaration | undefined {
    return this.#block.find(name);
  }

  getPropertyValue(property: string): string {
    const declaration = this.#block.find(normalizePropertyName(property));
    return declaration === undefined
      ? ''
      : serializePropertyDeclaration(declaration).value;
  }

  getPropertyPriority(property: string): string {
    return this.#block.find(normalizePropertyName(property))?.important
      ? 'important'
      : '';
  }

  setProperty(
    property: string,
    value: string,
    priority = '',
  ): void {
    this.#assertMutable();

    const name = normalizePropertyName(property);
    if (!isCustomPropertyName(name) && !isSupportedPropertyName(name)) return;

    if (value === '') {
      this.removeProperty(name);
      return;
    }

    if (priority !== '' && asciiLower(priority) !== 'important') return;

    const declaration = parsePropertyDeclaration(
      name,
      value,
      priority !== '',
      {},
    );
    if (declaration === null || !this.#block.set(declaration)) return;

    this.#commit();
  }

  removeProperty(property: string): string {
    this.#assertMutable();

    const name = normalizePropertyName(property);
    const value = this.getPropertyValue(name);
    if (!this.#block.remove(name)) return value;
    this.#commit();
    return value;
  }

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

  #updateStyleAttribute(): void {
    if (this.#ownerNode === null || this.#computed) return;

    this.#updating = true;
    try {
      this.#env.userAgent.dom.setAttributeNS(this.#ownerNode, null, 'style', this.cssText);
    } finally {
      this.#updating = false;
    }
  }

  #commit(): void {
    this.#updateStyleAttribute();
  }

  #assertMutable(): void {
    if (!this.#readonly) return;

    throw new DOMExceptionImpl(
      'The CSS declaration block is read-only.',
      'NoModificationAllowedError',
    );
  }
}

type CSSStyleDeclarationOptions = {
  block?: CSSDeclarationBlock;
  computed?: boolean;
  readonly?: boolean;
  parentRule?: CSSRuleImpl | null;
  /** Attribute write-back target; attaching an owner does not read its current attribute. */
  ownerNode?: Element | null;
};

function parsePropertyDeclaration(
  property: string,
  value: string,
  important: boolean,
  context: PropertyContext,
): PropertyDeclaration | null {
  const syntaxDeclaration = parseDeclaration(`${property}: ${value}`, context);
  if (syntaxDeclaration === null || syntaxDeclaration.important) return null;

  syntaxDeclaration.important = important;
  return interpretPropertyDeclaration(syntaxDeclaration, context);
}

function normalizePropertyName(name: string): string {
  return isCustomPropertyName(name) ? name : asciiLower(name);
}

function isSupportedPropertyName(
  name: string,
): name is keyof typeof propertyRegistry {
  return Object.hasOwn(propertyRegistry, name);
}

function isCustomPropertyName(name: string): name is `--${string}` {
  return name.startsWith('--');
}

// https://drafts.csswg.org/cssom/#the-cssstyledeclaration-interface
export const cssStyleDeclarationIDL = defineInterface({
  name: 'CSSStyleDeclaration',
  exposed: 'Window',
  implementation: impl(CSSStyleDeclarationImpl),
  members: [
    attr('cssText', reference('CSSOMString'), xattr('CEReactions')),
    roAttr('length', idlType.unsignedLong),
    op('item', reference('CSSOMString'),
      [arg('index', idlType.unsignedLong)],
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
