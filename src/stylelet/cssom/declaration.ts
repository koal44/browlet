import { asciiLower } from '../../shared/css';
import {
  interpretPropertyDeclaration, propertyRegistry,
  serializePropertyDeclaration, type PropertyDeclaration,
} from '../css/property';
import {
  parseBlockContents, parseDeclaration, type ParserInput,
} from '../syntax/parser';
import {
  domExceptionName, throwDOMException,
} from '../../shared/dom-exception';
import { withCSSStyleDeclaration } from './stubs/extensions';

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
export class CSSStyleDeclarationImpl
  extends withCSSStyleDeclaration(class {})
  implements CSSStyleDeclaration
{
  [index: number]: string;

  #declarations: PropertyDeclaration[] = [];
  readonly #computed: boolean;
  readonly #readonly: boolean;
  readonly #parentRule: CSSRule | null;
  readonly #ownerNode: Element | null;
  readonly #onChange: (
    declarations: readonly PropertyDeclaration[],
  ) => void;
  #updating = false;

  constructor({
    declarations = [],
    computed = false,
    readonly = false,
    parentRule = null,
    ownerNode = null,
    onChange = () => {},
  }: CSSStyleDeclarationOptions = {}) {
    super();
    this.#computed = computed;
    this.#readonly = readonly;
    this.#parentRule = parentRule;
    this.#ownerNode = ownerNode;
    this.#onChange = onChange;
    this.#replaceDeclarations(declarations);

    if (!computed && ownerNode !== null) {
      const value = ownerNode.getAttribute('style');
      if (value !== null) {
        this.#replaceDeclarations(parseDeclarationBlock(value));
      }
    }
  }

  get cssText(): string {
    return this.#computed ? '' : serializeDeclarationBlock(this.#declarations);
  }

  set cssText(value: string) {
    this.#assertMutable();
    this.#replaceDeclarations(parseDeclarationBlock(String(value)));
    this.#commit();
  }

  get length(): number {
    return this.#declarations.length;
  }

  get parentRule(): CSSRule | null {
    return this.#parentRule;
  }

  item(index: number): string {
    return this.#declarations[index]?.name ?? '';
  }

  getPropertyValue(property: string): string {
    const declaration = this.#find(normalizePropertyName(String(property)));
    return declaration === undefined
      ? ''
      : serializePropertyDeclaration(declaration).value;
  }

  getPropertyPriority(property: string): string {
    return this.#find(normalizePropertyName(String(property)))?.important
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
    );
    if (declaration === null || !this.#setDeclaration(declaration)) return;

    this.#commit();
  }

  removeProperty(property: string): string {
    this.#assertMutable();

    const name = normalizePropertyName(String(property));
    const value = this.getPropertyValue(name);
    const index = this.#declarations.findIndex(
      (declaration) => declaration.name === name,
    );
    if (index < 0) return value;

    const previousLength = this.length;
    this.#declarations.splice(index, 1);
    this.#syncIndices(previousLength);
    this.#commit();
    return value;
  }

  [Symbol.iterator](): ArrayIterator<string> {
    return this.#declarations.map(({ name }) => name)[Symbol.iterator]();
  }

  get __declarations(): readonly PropertyDeclaration[] {
    return this.#declarations;
  }

  __attributeChanged(
    localName: string,
    value: string | null,
    namespace: string | null = null,
  ): void {
    if (this.#computed || this.#updating) return;
    if (localName !== 'style' || namespace !== null) return;

    this.#replaceDeclarations(
      value === null ? [] : parseDeclarationBlock(value),
    );
    this.#onChange(this.#declarations);
  }

  #find(name: string): PropertyDeclaration | undefined {
    return this.#declarations.find(
      (declaration) => declaration.name === name,
    );
  }

  #replaceDeclarations(declarations: readonly PropertyDeclaration[]): void {
    const previousLength = this.length;
    this.#declarations = [];

    for (const declaration of declarations) {
      this.#setDeclaration(declaration, true);
    }

    this.#syncIndices(previousLength);
  }

  #setDeclaration(
    declaration: PropertyDeclaration,
    respectImportance = false,
  ): boolean {
    const index = this.#declarations.findIndex(
      ({ name }) => name === declaration.name,
    );

    if (index < 0) {
      this.#declarations.push(declaration);
      this.#syncIndices(this.length - 1);
      return true;
    }

    const previous = this.#declarations[index]!;
    if (respectImportance && previous.important && !declaration.important) {
      return false;
    }

    const previousValue = serializePropertyDeclaration(previous).value;
    const nextValue = serializePropertyDeclaration(declaration).value;
    if (
      previous.important === declaration.important &&
      previousValue === nextValue
    ) {
      return false;
    }

    this.#declarations[index] = declaration;
    return true;
  }

  #syncIndices(previousLength: number): void {
    for (let index = previousLength; index < this.length; index++) {
      Object.defineProperty(this, index, {
        configurable: true,
        enumerable: true,
        get: () => this.item(index),
      });
    }

    for (let index = this.length; index < previousLength; index++) {
      Reflect.deleteProperty(this, String(index));
    }
  }

  #updateStyleAttribute(): void {
    if (this.#ownerNode === null || this.#computed) return;

    this.#updating = true;
    try {
      this.#ownerNode.setAttribute('style', this.cssText);
    } finally {
      this.#updating = false;
    }
  }

  #commit(): void {
    this.#onChange(this.#declarations);
    this.#updateStyleAttribute();
  }

  #assertMutable(): void {
    if (!this.#readonly) return;

    throwDOMException(
      domExceptionName.noModificationAllowed,
      'The CSS declaration block is read-only.',
    );
  }
}

type CSSStyleDeclarationOptions = {
  declarations?: readonly PropertyDeclaration[];
  computed?: boolean;
  readonly?: boolean;
  parentRule?: CSSRule | null;
  ownerNode?: Element | null;
  onChange?: (declarations: readonly PropertyDeclaration[]) => void;
};

export function parseDeclarationBlock(
  input: ParserInput,
): PropertyDeclaration[] {
  const declarations: PropertyDeclaration[] = [];

  for (const item of parseBlockContents(input)) {
    if (!Array.isArray(item)) continue;

    for (const syntaxDeclaration of item) {
      const declaration = interpretPropertyDeclaration(syntaxDeclaration);
      if (declaration !== null) declarations.push(declaration);
    }
  }

  return declarations;
}

function serializeDeclarationBlock(
  declarations: readonly PropertyDeclaration[],
): string {
  return declarations.map(serializeDeclaration).join(' ');
}

function serializeDeclaration(declaration: PropertyDeclaration): string {
  const { name, value, important } = serializePropertyDeclaration(declaration);
  return `${name}: ${value}${important ? ' !important' : ''};`;
}

function parsePropertyDeclaration(
  property: string,
  value: string,
  important: boolean,
): PropertyDeclaration | null {
  const syntaxDeclaration = parseDeclaration(`${property}: ${value}`);
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
