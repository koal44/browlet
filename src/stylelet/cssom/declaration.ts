import type { DOMElement as Element } from '../../infra/index';
import { asciiLower } from '../../infra/ascii';

import type { StyleletEnvironment } from '../environment';
import { parseDeclaration } from '../syntax/index';
import {
  interpretPropertyDeclaration, propertyRegistry, serializePropertyDeclaration, CSSDeclarationBlock,
  type PropertyDeclaration,
} from '../css/index';

import type { CSSRuleImpl } from './rule';
import { CSSParsingContext } from './parser';

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
 *
 * [Exposed=Window]
 * interface CSSStyleProperties : CSSStyleDeclaration {
 *   [CEReactions] attribute [LegacyNullToEmptyString] CSSOMString cssFloat;
 * };
 */
export class CSSStyleDeclarationImpl {
  [index: number]: string;

  #block: CSSDeclarationBlock;
  #indexedLength = 0;
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
    this.synchronizeIndices();
  }

  get cssText(): string {
    return this.#computed ? '' : this.#block.cssText;
  }

  set cssText(value: string) {
    this.#assertMutable();
    this.#block.setText(String(value), new CSSParsingContext(null, false, this.#env));
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
    const declaration = this.#block.find(normalizePropertyName(String(property)));
    return declaration === undefined
      ? ''
      : serializePropertyDeclaration(declaration).value;
  }

  getPropertyPriority(property: string): string {
    return this.#block.find(normalizePropertyName(String(property)))?.important
      ? 'important'
      : '';
  }

  setProperty(
    property: string,
    value: string | null,
    priority: string | null = '',
  ): void {
    this.#assertMutable();

    const name = normalizePropertyName(String(property));
    if (!isCustomPropertyName(name) && !isSupportedPropertyName(name)) return;

    value = String(value ?? '');
    if (value === '') {
      this.removeProperty(name);
      return;
    }

    priority = String(priority ?? '');
    if (priority !== '' && asciiLower(priority) !== 'important') return;

    const declaration = parsePropertyDeclaration(
      name,
      value,
      priority !== '',
      new CSSParsingContext(null, false, this.#env),
    );
    if (declaration === null || !this.#block.set(declaration)) return;

    this.#commit();
  }

  removeProperty(property: string): string {
    this.#assertMutable();

    const name = normalizePropertyName(String(property));
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

    this.#block.setText(value ?? '', new CSSParsingContext(null, false, this.#env));
    this.synchronizeIndices();
  }

  /** Update exposed numeric properties after the owner changes the shared block. */
  // PROVISIONAL: indexed properties belong to Binding once CSSOM projection is complete.
  synchronizeIndices(): void {
    const length = this.length;
    for (let index = this.#indexedLength; index < length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }

    for (let index = length; index < this.#indexedLength; index++) {
      Reflect.deleteProperty(this, String(index));
    }
    this.#indexedLength = length;
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
    this.synchronizeIndices();
    this.#updateStyleAttribute();
  }

  #assertMutable(): void {
    if (!this.#readonly) return;

    throw new this.#env.exec.DOMException(
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
  context: CSSParsingContext,
): PropertyDeclaration | null {
  const syntaxDeclaration = parseDeclaration(`${property}: ${value}`, context);
  if (syntaxDeclaration === null || syntaxDeclaration.important) return null;

  syntaxDeclaration.important = important;
  return interpretPropertyDeclaration(syntaxDeclaration);
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

function installPropertyAccessors(): void {
  installPropertyAccessor('cssFloat', 'float');

  for (const property of Object.keys(propertyRegistry)) {
    installPropertyAccessor(cssPropertyToIDLAttribute(property), property);
    if (property.includes('-')) installPropertyAccessor(property, property);
  }
}

function installPropertyAccessor(attribute: string, property: string): void {
  if (Object.hasOwn(CSSStyleDeclarationImpl.prototype, attribute)) return;

  Object.defineProperty(CSSStyleDeclarationImpl.prototype, attribute, {
    configurable: true,
    enumerable: true,
    get(this: CSSStyleDeclarationImpl) {
      return this.getPropertyValue(property);
    },
    set(this: CSSStyleDeclarationImpl, value: string | null) {
      this.setProperty(property, value);
    },
  });
}

function cssPropertyToIDLAttribute(property: string): string {
  return property.replace(
    /-([a-z])/g,
    (_, letter: string) => letter.toUpperCase(),
  );
}

installPropertyAccessors();
