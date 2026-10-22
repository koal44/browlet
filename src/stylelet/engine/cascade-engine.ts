import type { DOMElement as Element } from '../../infra/index';
import { InternalError } from '../../infra/internal-error';

import type { StyleletURL } from '../environment';
import { ValueStage } from '../value-processing/index';
import {
  CssWideValue, GuaranteedInvalidValue, guaranteedInvalidValue, OptionalDeclarationValue, SubstitutionValue,
  PendingSubstitutionValue, type PendingShorthand, type WholeValue, type Value,
} from '../values/index';
import {
  propertyRegistry, type BuiltInPropertyName, type CustomPropertyName, type CustomPropertyRegistration,
  type CustomPropertyRegistry, type PropertyContext, type PropertyName, type PropertyValue,
} from '../props/index';
import { matchSelectorList, type Specificity } from '../selector/index';
import type { StyleletContext } from '../context';
import { CSSDeclarationBlock, InterpretedDeclaration } from '../cssom/declarations/index';
import {
  CSSNestedDeclarationsImpl, CSSPropertyRuleImpl, CSSStylePropertiesImpl, CSSStyleRuleImpl,
  CSSStyleSheetImpl, type CSSStyleDeclarationImpl, type CSSStyleSheetInit,
} from '../cssom/index';

import type { TreeScope } from './tree-scope';
import { createSystemColorPalette, type SystemColorPalette } from './system-colors';

/** Select declarations and compute values using the owning document's context. */
export class CascadeEngine {
  /** Specificity used by element-free declaration queries. */
  static #zeroSpecificity: Specificity = { a: 0, b: 0, c: 0 };

  /** Document-wide custom-property registrations, pending integration with the document's registry. */
  registeredPropertySet: CustomPropertyRegistry;

  /** Document API base URL used when a declaration's stylesheet supplies neither a base nor a location. */
  environmentBaseUrl: StyleletURL | undefined;

  /** Owning document's matching state and host facilities. */
  context: StyleletContext;

  /** Lazily retained defaults for standalone hosts that do not supply a palette. */
  #defaultSystemColors?: SystemColorPalette;

  /** Retain the document context, fallback URL base, and optional registration map. */
  constructor(options: CascadeEngineOptions) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map();
    this.environmentBaseUrl = options.environmentBaseUrl;
    this.context = options.context;
  }

  /** Compare importance and specificity; the caller resolves ties by appearance order. */
  // https://drafts.csswg.org/css-cascade-5/#cascade-sort
  // https://drafts.csswg.org/selectors-4/#specificity-rules
  static #comparePrecedence(
    left: InterpretedDeclaration,
    leftSpecificity: Specificity,
    right: InterpretedDeclaration,
    rightSpecificity: Specificity,
  ): number {
    return Number(left.important) - Number(right.important) ||
      leftSpecificity.a - rightSpecificity.a ||
      leftSpecificity.b - rightSpecificity.b ||
      leftSpecificity.c - rightSpecificity.c;
  }

  /** Create a stylesheet constructed for this engine's document. */
  createStyleSheet(options: Partial<CSSStyleSheetInit> = {}): CSSStyleSheetImpl {
    return CSSStyleSheetImpl.createConstructed({
      baseURL: options.baseURL ?? null,
      media: options.media ?? '',
      disabled: options.disabled ?? false,
    }, this.context.document, this.context.env);
  }

  /** Yield enabled associated/adopted sheets; media-condition evaluation remains unfinished. */
  *getActiveStyleSheets(
    scope: TreeScope,
  ): IterableIterator<CSSStyleSheetImpl> {
    for (const styleSheet of scope.finalStyleSheets()) {
      if (!styleSheet.disabled) yield styleSheet;
    }
  }

  /** Build the current limited computed-style snapshot from inline and matched-sheet declarations. */
  // https://drafts.csswg.org/cssom/#dom-window-getcomputedstyle
  getComputedStyle(
    element: Element,
    scope: TreeScope,
  ): CSSStyleDeclarationImpl {
    // Reuse parent results within this query; DOM, sheet, registration, and host inputs can change before the next one.
    const declarations = new Map<Element, CascadedProperties>();
    const customPropertiesByElement = new Map<Element, ComputedCustomProperties>();
    const builtInPropertiesByElement = new Map<Element, ComputedBuiltInProperties>();
    const guards: CustomPropertyGuard[] = [];
    const computed: InterpretedDeclaration[] = [];
    for (const name of Object.keys(propertyRegistry) as BuiltInPropertyName[]) {
      const value = this.#getBuiltInProperty(name, element, scope, declarations, builtInPropertiesByElement, customPropertiesByElement, guards);
      computed.push(new InterpretedDeclaration(name, value) as InterpretedDeclaration<BuiltInPropertyName>);
    }
    for (const name of this.#getCustomPropertyNames(element, scope, declarations)) {
      const value = this.#getCustomProperty(name, element, scope, declarations, customPropertiesByElement, guards);
      // SPEC_CLASH(guaranteed-invalid-enumeration): Follow CSSOM by excluding invalid
      // values; Chromium, Firefox, and WebKit enumerate names explicitly reset to initial.
      if (!(value instanceof GuaranteedInvalidValue)) computed.push(new InterpretedDeclaration(name, value));
    }
    return new CSSStylePropertiesImpl({
      computed: true,
      block: new CSSDeclarationBlock(computed),
      readonly: true,
    }, this.context.env);
  }

  /** Select a property without an element, treating selector specificity as zero. */
  getCascadedProperty(
    name: PropertyName,
    scope: TreeScope,
  ): CascadedProperty | null {
    return this.#getCascadedProperties(scope).get(name) ?? null;
  }

  /** Select a property from rules matching this element in the supplied scope. */
  getCascadedPropertyForElement(
    name: PropertyName,
    element: Element,
    scope: TreeScope,
  ): CascadedProperty | null {
    return this.#getCascadedProperties(scope, element).get(name) ?? null;
  }

  /** Supply host color inputs and, when present, the selected declaration's URL base and scope. */
  getPropertyContext(property?: CascadedProperty): PropertyContext {
    const styleSheet = property?.styleSheet;
    const baseUrl = styleSheet?.baseURL ??
      styleSheet?.location ??
      this.environmentBaseUrl;

    return {
      URL: this.context.env.userAgent.URL,
      systemColors: this.context.env.userAgent.systemColors ?? (this.#defaultSystemColors ??= createSystemColorPalette()),
      treeScope: property?.scope,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  /** Find a document registration or the last applicable @property registration in the scope. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#determining-registration
  getCustomPropertyRegistration(
    name: CustomPropertyName,
    scope: TreeScope,
  ): CustomPropertyRegistration | null {
    const registered = this.registeredPropertySet.get(name);
    if (registered !== undefined) return registered;

    let declared = null;
    for (const styleSheet of this.getActiveStyleSheets(scope)) {
      for (const rule of styleSheet.ruleList) {
        if (rule instanceof CSSPropertyRuleImpl && rule.registration.name === name) {
          declared = rule.registration;
        }
      }
    }
    return declared;
  }

  /** Select all property names together so custom properties participate without a fixed registry. */
  // https://drafts.csswg.org/css-cascade-5/#cascade-sort
  // This is the author-normal/important slice of cascade sorting. Origins,
  // encapsulation context, layers, animations, and transitions enter here as
  // their representations are added to the engine.
  #getCascadedProperties(scope: TreeScope, element?: Element): CascadedProperties {
    const result = new Map<PropertyName, CascadedProperty & { specificity: Specificity; }>();

    for (const styleSheet of this.getActiveStyleSheets(scope)) {
      for (const rule of styleSheet.ruleList) {
        if (!(rule instanceof CSSStyleRuleImpl)) continue;

        const specificity = element === undefined
          ? CascadeEngine.#zeroSpecificity
          : matchSelectorList(rule.selectors, element, this.context);
        if (specificity === null) continue;

        for (const declaration of this.#ruleDeclarations(rule)) {
          const previous = result.get(declaration.name);
          if (previous !== undefined &&
            CascadeEngine.#comparePrecedence(declaration, specificity, previous.declaration, previous.specificity) < 0) continue;

          result.set(declaration.name, { declaration, styleSheet, scope, specificity });
        }
      }
    }
    return result;
  }

  /** Visit a rule's own blocks in appearance order, including later declaration runs. */
  // Implementation helper, combining these requirements rather than a named specification algorithm:
  // CSS Cascade: https://drafts.csswg.org/css-cascade-5/#cascade-sort (importance and appearance order).
  // CSS Nesting: https://drafts.csswg.org/css-nesting-1/#nested-declarations (parent matching/specificity).
  *#ruleDeclarations(rule: CSSStyleRuleImpl): IterableIterator<InterpretedDeclaration> {
    yield* rule.style.declarations;
    for (const child of rule.cssRules) {
      // TODO: cascade nested style/group rules using their own matching conditions.
      if (child instanceof CSSNestedDeclarationsImpl) yield* child.style.declarations;
    }
  }

  /** Select between inline and sheet declarations; inline wins at equal importance. */
  #getDeclarations(
    element: Element,
    scope: TreeScope,
    declarations: Map<Element, CascadedProperties>,
  ): CascadedProperties {
    const cached = declarations.get(element);
    if (cached !== undefined) return cached;
    const dom = this.context.dom;
    const root = dom.root(element);
    if (dom.isShadowRoot(root) && root !== scope.root) {
      // TODO: Have the query owner supply the element's shadow scope before matching its sheets.
      throw new InternalError('Computed-style shadow-scope selection is not implemented');
    }

    const block = dom.inlineStyleBlock?.(element);
    // An absent provider permits text fallback; a provider's empty result is authoritative.
    const inline = block === undefined
      ? new CSSDeclarationBlock(InterpretedDeclaration.parseBlock(dom.getAttributeNS(element, null, 'style') ?? '', {}))
      : block instanceof CSSDeclarationBlock ? block : null;
    const selected = this.#getCascadedProperties(scope, element);
    for (const declaration of inline?.declarations ?? []) {
      const cascaded = selected.get(declaration.name)?.declaration;
      if (cascaded === undefined || declaration.important || !cascaded.important) {
        selected.set(declaration.name, { declaration, styleSheet: null, scope });
      }
    }
    declarations.set(element, selected);
    return selected;
  }

  /** Reparse a winning built-in, then inherit or use its initial value when computation fails. */
  // https://drafts.csswg.org/css-values-5/#resolve-property
  // https://drafts.csswg.org/css-values-5/#invalid-at-computed-value-time
  // https://drafts.csswg.org/css-cascade-5/#defaulting
  #getBuiltInProperty(
    name: BuiltInPropertyName,
    element: Element,
    scope: TreeScope,
    declarations: Map<Element, CascadedProperties>,
    builtInPropertiesByElement: Map<Element, ComputedBuiltInProperties>,
    customPropertiesByElement: Map<Element, ComputedCustomProperties>,
    guards: CustomPropertyGuard[],
  ): PropertyValue<BuiltInPropertyName> {
    let values = builtInPropertiesByElement.get(element);
    if (values === undefined) {
      values = { properties: new Map(), shorthands: new Map() };
      builtInPropertiesByElement.set(element, values);
    }
    const cached = values.properties.get(name);
    if (cached !== undefined) return cached;

    const property = this.#getDeclarations(element, scope, declarations).get(name);
    const context = this.getPropertyContext(property);
    const declaration = property?.declaration;
    context.getCustomProperty = (referencedName) =>
      this.#getCustomProperty(referencedName, element, scope, declarations, customPropertiesByElement, guards);
    let specified = declaration !== undefined && !declaration.custom ? declaration.value : undefined;
    if (specified instanceof PendingSubstitutionValue) {
      let expanded = values.shorthands.get(specified.shorthand);
      if (expanded === undefined) {
        expanded = specified.expand(context);
        values.shorthands.set(specified.shorthand, expanded);
      }
      specified = expanded?.[specified.index] as PropertyValue<BuiltInPropertyName> | undefined;
    }
    let computed = specified?.resolve(ValueStage.Computed, context);
    const value = computed?.value;
    const keyword = value instanceof CssWideValue ? value.value : undefined;
    const record = propertyRegistry[name];

    if (keyword === 'revert' || keyword === 'revert-layer') {
      // TODO: Preserve origin/layer candidates for rollback during the full Cascade review.
      throw new InternalError('Built-in property cascade rollback is not implemented');
    }
    if (computed === undefined || value instanceof GuaranteedInvalidValue || keyword !== undefined) {
      // A computed-time failure defaults like unset; it never revives an earlier declaration.
      const inherit = keyword === 'inherit' || (keyword !== 'initial' && record.inherits);
      const parent = inherit ? this.#getInheritanceParent(element, scope) : null;
      computed = parent === null
        ? record.initialValue.resolve(ValueStage.Computed, context)
        : this.#getBuiltInProperty(name, parent, scope, declarations, builtInPropertiesByElement, customPropertiesByElement, guards);
    }

    // TODO: Supply font/viewport facts, per-element color-scheme selection, and
    // currentColor/other used-value inputs required by CSSOM.
    // Resolution stays within this registry entry's value family.
    const result = computed as PropertyValue<BuiltInPropertyName>;
    values.properties.set(name, result);
    return result;
  }

  /** Resolve a custom property, inheriting computed values rather than declarations. */
  // https://drafts.csswg.org/css-variables-1/#defining-variables
  // https://drafts.csswg.org/css-cascade-5/#defaulting
  #getCustomProperty(
    name: CustomPropertyName,
    element: Element,
    scope: TreeScope,
    declarations: Map<Element, CascadedProperties>,
    customPropertiesByElement: Map<Element, ComputedCustomProperties>,
    guards: CustomPropertyGuard[],
  ): ComputedCustomProperty {
    let values = customPropertiesByElement.get(element);
    if (values === undefined) {
      values = new Map();
      customPropertiesByElement.set(element, values);
    }
    const cached = values.get(name);
    if (cached !== undefined) return cached;
    // https://drafts.csswg.org/css-values-5/#substitution-context
    // Include the element: inheriting the same name from a parent is not a cycle.
    const cycle = guards.findIndex((guard) => guard.element === element && guard.name === name);
    if (cycle !== -1) {
      for (let i = cycle; i < guards.length; i++) guards[i]!.cyclic = true;
      return guaranteedInvalidValue;
    }
    if (this.getCustomPropertyRegistration(name, scope) !== null) {
      // TODO: Apply registered syntax, inherits, initial value, and computational independence.
      throw new InternalError('Registered custom-property computation is not implemented');
    }

    const guard = { element, name, cyclic: false };
    guards.push(guard);
    try {
      const declaration = this.#getDeclarations(element, scope, declarations).get(name)?.declaration;
      let value: ComputedCustomProperty = declaration?.custom ? declaration.value : guaranteedInvalidValue;
      if (value instanceof OptionalDeclarationValue && SubstitutionValue.containsFunction(value.value)) {
        const substituted = new SubstitutionValue(value).substitute((referencedName) =>
          this.#getCustomProperty(referencedName, element, scope, declarations, customPropertiesByElement, guards),
        );
        value = substituted instanceof GuaranteedInvalidValue ? substituted :
          OptionalDeclarationValue.parse(substituted, {}) ?? guaranteedInvalidValue;
      }
      if (guard.cyclic) value = guaranteedInvalidValue;
      // https://drafts.csswg.org/css-values-5/#resolve-property
      // Substitution can itself produce a CSS-wide keyword, so default after replacement.
      const keyword = value instanceof OptionalDeclarationValue ? CssWideValue.parse(value.value, {})?.value : undefined;
      if (!declaration?.custom || keyword === 'inherit' || keyword === 'unset') {
        const parent = this.#getInheritanceParent(element, scope);
        value = parent === null ? guaranteedInvalidValue :
          this.#getCustomProperty(name, parent, scope, declarations, customPropertiesByElement, guards);
      } else if (keyword === 'initial') {
        value = guaranteedInvalidValue;
      } else if (keyword === 'revert' || keyword === 'revert-layer') {
        // TODO: Cascade rollback needs the earlier origin/layer candidates, not just this winner.
        throw new InternalError('Custom-property cascade rollback is not implemented');
      }
      values.set(name, value);
      return value;
    } finally {
      guards.pop();
    }
  }

  /** Collect inherited names without computing overridden parent values. */
  #getCustomPropertyNames(
    element: Element,
    scope: TreeScope,
    declarations: Map<Element, CascadedProperties>,
  ): Set<CustomPropertyName> {
    const parent = this.#getInheritanceParent(element, scope);
    const names = parent === null ? new Set<CustomPropertyName>() : this.#getCustomPropertyNames(parent, scope, declarations);
    for (const { declaration } of this.#getDeclarations(element, scope, declarations).values()) {
      if (declaration.custom) names.add(declaration.name);
    }
    return names;
  }

  /** Obtain the flat-tree inheritance parent, or null at the root. */
  // https://drafts.csswg.org/css-cascade-5/#inheriting
  #getInheritanceParent(element: Element, scope: TreeScope): Element | null {
    const dom = this.context.dom;
    const parent = dom.flatTreeParent(element);
    if (parent === null || !dom.isElement(parent)) return null;
    if (dom.isShadowRoot(scope.root) && dom.root(parent) !== scope.root) {
      // TODO: Select the host's scope when inheritance crosses a shadow boundary.
      throw new InternalError('Computed-style shadow-scope selection is not implemented');
    }
    return parent;
  }
}

/** Existing document state used when constructing a cascade engine. */
export type CascadeEngineOptions = {
  /** Last-resort base URL for stylesheet values. */
  environmentBaseUrl?: StyleletURL;
  /** Document-level custom-property registrations; omitted creates an empty registry. */
  registeredPropertySet?: CustomPropertyRegistry;
  /** Document state and host facilities shared with selector matching. */
  context: StyleletContext;
};

/** Selected declaration and its provenance; inline declarations have no stylesheet. */
export type CascadedProperty = {
  declaration: InterpretedDeclaration;
  styleSheet: CSSStyleSheetImpl | null;
  scope: TreeScope;
};

/** Selected declarations indexed by their exact property names. */
type CascadedProperties = Map<PropertyName, CascadedProperty>;

/** Query-local built-in results, including one expansion per shorthand occurrence and element. */
type ComputedBuiltInProperties = {
  properties: Map<BuiltInPropertyName, PropertyValue<BuiltInPropertyName>>;
  shorthands: Map<
    PendingShorthand<Value<PropertyContext>>,
    WholeValue<Value<PropertyContext>>[] | null
  >;
};

/** Computed custom-property values belonging to one element in this query. */
type ComputedCustomProperties = Map<CustomPropertyName, ComputedCustomProperty>;

/** Empty token sequences are valid values; absence and initial defaulting use the distinct sentinel. */
type ComputedCustomProperty = OptionalDeclarationValue | GuaranteedInvalidValue;

/** One active property dependency; every participant is marked when a name recurs on the same element. */
type CustomPropertyGuard = {
  element: Element;
  name: CustomPropertyName;
  cyclic: boolean;
};
