import type { DOMElement as Element } from '../../infra/index';
import { InternalError } from '../../infra/internal-error';
import type { URLRecord } from '../../url/core/index';

import { ValueStage } from '../value-processing/index';
import type { PendingShorthand, WholeValue, Value } from '../values/index';
import {
  propertyRegistry, CustomProperty, type BuiltInPropertyName,
  type CustomPropertyName, type CustomPropertyRegistration, type CustomPropertyValue,
  type CustomPropertyRegistry, type PropertyContext, type PropertyName,
  type BuiltInProperty,
} from '../props/index';
import { matchSelectorList, type Specificity } from '../selector/index';
import type { StyleletContext } from '../context';
import { CSSDeclarationBlock, InterpretedDeclaration } from '../cssom/declarations/index';
import {
  CSSNestedDeclarationsImpl, CSSPropertyRuleImpl, CSSStylePropertiesImpl, CSSStyleRuleImpl,
  CSSStyleSheetImpl, type CSSStyleDeclarationImpl, type CSSStyleSheetInit,
} from '../cssom/index';

import type { TreeScope } from './tree-scope';
import { ComputedStyle } from './computed-style';
import { createSystemColorPalette, type SystemColorPalette } from './system-colors';

/** Select declarations and compute values using the owning document's context. */
export class CascadeEngine {
  /** Specificity used by element-free declaration queries. */
  static #zeroSpecificity: Specificity = { a: 0, b: 0, c: 0 };

  /** Explicit document registrations, pending integration with CSS.registerProperty(). */
  registeredPropertySet: CustomPropertyRegistry;

  /** Document API base URL used when a declaration's stylesheet supplies neither a base nor a location. */
  environmentBaseUrl: URLRecord | undefined;

  /** Owning document's matching state and host facilities. */
  context: StyleletContext;

  /** Lazily retained defaults for standalone hosts that do not supply a palette. */
  #defaultSystemColors?: SystemColorPalette;

  /** Retain the document context, fallback URL base, and optional registration map. */
  constructor(options: CascadeEngineOptions) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map<CustomPropertyName, CustomPropertyRegistration>();
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
    const cascadedByElement = new Map<Element, CascadedProperties>();
    const customValuesByElement = new Map<Element, ComputedCustomValues>();
    const builtInCacheByElement = new Map<Element, BuiltInPropertyCache>();
    const customPropertyRegistry = this.collectCustomPropertyRegistry(scope);
    const dependencyStack: CustomPropertyDependency[] = [];
    const computedStyle = new ComputedStyle();
    for (const property of Object.values(propertyRegistry)) {
      if (property.shorthand !== undefined) continue;
      const value = this.#getComputedBuiltInValue(
        property, element, scope, cascadedByElement, builtInCacheByElement,
        customValuesByElement, dependencyStack, customPropertyRegistry,
      );
      computedStyle.set(property, value);
    }
    for (const property of this.#getCustomProperties(element, scope, cascadedByElement).values()) {
      const value = this.#getComputedCustomValue(
        property.name, element, scope, cascadedByElement, customValuesByElement, dependencyStack, customPropertyRegistry,
      );
      // SPEC_CLASH(guaranteed-invalid-enumeration): Follow CSSOM by excluding invalid
      // values; Chromium, Firefox, and WebKit enumerate names explicitly reset to initial.
      if (!value.isGuaranteedInvalid()) {
        computedStyle.set(property, value);
      }
    }
    return new CSSStylePropertiesImpl({
      computedStyle,
      readonly: true,
    }, this.context.env);
  }

  /** Select a property without an element, treating selector specificity as zero. */
  getCascadedProperty(
    name: PropertyName,
    scope: TreeScope,
  ): CascadedProperty | null {
    return this.#getCascadedSheetDeclarations(scope).get(name) ?? null;
  }

  /** Select a property from rules matching this element in the supplied scope. */
  getCascadedPropertyForElement(
    name: PropertyName,
    element: Element,
    scope: TreeScope,
  ): CascadedProperty | null {
    return this.#getCascadedSheetDeclarations(scope, element).get(name) ?? null;
  }

  /** Supply host color inputs and, when present, the selected declaration's URL base and scope. */
  getPropertyContext(cascaded?: CascadedProperty): PropertyContext {
    const { userAgent } = this.context.env;
    const styleSheet = cascaded?.styleSheet;
    const baseUrl = styleSheet?.baseURL ??
      styleSheet?.location ??
      this.environmentBaseUrl;

    return {
      env: this.context.env,
      systemColors: userAgent.systemColors ?? (this.#defaultSystemColors ??= createSystemColorPalette()),
      treeScope: cascaded?.scope,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  /** Collect active @property rules, then apply the higher-priority explicit registrations. */
  // https://drafts.css-houdini.org/css-properties-values-api-1/#determining-registration
  collectCustomPropertyRegistry(scope: TreeScope): CustomPropertyRegistry {
    // TODO: Collect registrations across the document's shadow scopes as well.
    const registry = new Map<CustomPropertyName, CustomPropertyRegistration>();
    for (const styleSheet of this.getActiveStyleSheets(scope)) {
      for (const rule of styleSheet.ruleList) {
        if (rule instanceof CSSPropertyRuleImpl) {
          registry.set(rule.registration.name, rule.registration);
        }
      }
    }
    for (const [name, registration] of this.registeredPropertySet) registry.set(name, registration);
    return registry;
  }

  /** Select all property names together so custom properties participate without a fixed registry. */
  // https://drafts.csswg.org/css-cascade-5/#cascade-sort
  // This is the author-normal/important slice of cascade sorting. Origins,
  // encapsulation context, layers, animations, and transitions enter here as
  // their representations are added to the engine.
  #getCascadedSheetDeclarations(scope: TreeScope, element?: Element): CascadedProperties {
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
  #getCascadedDeclarations(
    element: Element,
    scope: TreeScope,
    cascadedByElement: Map<Element, CascadedProperties>,
  ): CascadedProperties {
    const cached = cascadedByElement.get(element);
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
      ? new CSSDeclarationBlock(InterpretedDeclaration.parseBlock(
        dom.getAttributeNS(element, null, 'style') ?? '', { env: this.context.env },
      ))
      : block instanceof CSSDeclarationBlock ? block : null;
    const selected = this.#getCascadedSheetDeclarations(scope, element);
    for (const declaration of inline?.declarations ?? []) {
      const cascaded = selected.get(declaration.name)?.declaration;
      if (cascaded === undefined || declaration.important || !cascaded.important) {
        selected.set(declaration.name, { declaration, styleSheet: null, scope });
      }
    }
    cascadedByElement.set(element, selected);
    return selected;
  }

  /** Reparse a winning built-in, then inherit or use its initial value when computation fails. */
  // https://drafts.csswg.org/css-values-5/#resolve-property
  // https://drafts.csswg.org/css-values-5/#invalid-at-computed-value-time
  // https://drafts.csswg.org/css-cascade-5/#defaulting
  #getComputedBuiltInValue(
    property: BuiltInProperty<Value, BuiltInPropertyName>,
    element: Element,
    scope: TreeScope,
    cascadedByElement: Map<Element, CascadedProperties>,
    builtInCacheByElement: Map<Element, BuiltInPropertyCache>,
    customValuesByElement: Map<Element, ComputedCustomValues>,
    dependencyStack: CustomPropertyDependency[],
    customPropertyRegistry: CustomPropertyRegistry,
  ): WholeValue {
    const { name } = property;
    let elementCache = builtInCacheByElement.get(element);
    if (elementCache === undefined) {
      elementCache = { propertyValues: new Map(), shorthandExpansions: new Map() };
      builtInCacheByElement.set(element, elementCache);
    }
    const cached = elementCache.propertyValues.get(name);
    if (cached !== undefined) return cached;

    const cascaded = this.#getCascadedDeclarations(element, scope, cascadedByElement).get(name);
    const context = this.getPropertyContext(cascaded);
    context.customPropertyRegistry = customPropertyRegistry;
    const declaration = cascaded?.declaration;
    context.getCustomProperty = (referencedName) => {
      const computed = this.#getComputedCustomValue(
        referencedName, element, scope, cascadedByElement, customValuesByElement, dependencyStack, customPropertyRegistry,
      );
      if (computed.isOrdinaryValue() || computed.isGuaranteedInvalid()) return computed.inner;
      throw new InternalError('Custom-property computation left unresolved notation');
    };
    let specified: WholeValue | undefined = declaration !== undefined && !declaration.custom ? declaration.value : undefined;
    if (specified?.isPendingSubstitution()) {
      let longhandValues = elementCache.shorthandExpansions.get(specified.shorthand);
      if (longhandValues === undefined) {
        longhandValues = specified.expandShorthand(context);
        elementCache.shorthandExpansions.set(specified.shorthand, longhandValues);
      }
      specified = longhandValues?.[specified.shorthandIndex];
    }
    let computed = specified === undefined ? undefined : property.resolve(specified, ValueStage.Computed, context);
    const keyword = computed?.cssWideKeyword();

    if (keyword === 'revert' || keyword === 'revert-layer') {
      // TODO: Preserve origin/layer candidates for rollback during the full Cascade review.
      throw new InternalError('Built-in property cascade rollback is not implemented');
    }
    if (computed === undefined || computed.isGuaranteedInvalid() || keyword !== undefined) {
      // A computed-time failure defaults like unset; it never revives an earlier declaration.
      const inherit = keyword === 'inherit' || (keyword !== 'initial' && property.inherits);
      const parent = inherit ? this.#getInheritanceParent(element, scope) : null;
      computed = parent === null
        ? property.resolve(property.initialValue, ValueStage.Computed, context)
        : this.#getComputedBuiltInValue(
          property, parent, scope, cascadedByElement, builtInCacheByElement,
          customValuesByElement, dependencyStack, customPropertyRegistry,
        );
    }

    // TODO: Supply font/viewport facts, per-element color-scheme selection, and
    // currentColor/other used-value inputs required by CSSOM.
    elementCache.propertyValues.set(name, computed);
    return computed;
  }

  /** Resolve a custom property, inheriting computed values rather than declarations. */
  // https://drafts.csswg.org/css-variables-1/#defining-variables
  // https://drafts.csswg.org/css-cascade-5/#defaulting
  #getComputedCustomValue(
    name: CustomPropertyName,
    element: Element,
    scope: TreeScope,
    cascadedByElement: Map<Element, CascadedProperties>,
    customValuesByElement: Map<Element, ComputedCustomValues>,
    dependencyStack: CustomPropertyDependency[],
    customPropertyRegistry: CustomPropertyRegistry,
  ): CustomPropertyValue {
    let computedValues = customValuesByElement.get(element);
    if (computedValues === undefined) {
      computedValues = new Map();
      customValuesByElement.set(element, computedValues);
    }
    const cached = computedValues.get(name);
    if (cached !== undefined) return cached;
    // https://drafts.csswg.org/css-values-5/#substitution-context
    // Include the element: inheriting the same name from a parent is not a cycle.
    const cycleStart = dependencyStack.findIndex((dependency) => dependency.element === element && dependency.name === name);
    if (cycleStart !== -1) {
      for (let i = cycleStart; i < dependencyStack.length; i++) dependencyStack[i]!.cyclic = true;
      return CustomProperty.initialValue;
    }
    const dependency = { element, name, cyclic: false };
    dependencyStack.push(dependency);
    try {
      const cascaded = this.#getCascadedDeclarations(element, scope, cascadedByElement).get(name);
      const declaration = cascaded?.declaration;
      const property = declaration?.custom ? declaration.property : new CustomProperty(name);
      const context = this.getPropertyContext(cascaded);
      context.customPropertyRegistry = customPropertyRegistry;
      context.getCustomProperty = (referencedName) => {
        const computed = this.#getComputedCustomValue(
          referencedName, element, scope, cascadedByElement, customValuesByElement, dependencyStack, customPropertyRegistry,
        );
        if (computed.isOrdinaryValue() || computed.isGuaranteedInvalid()) return computed.inner;
        throw new InternalError('Custom-property computation left unresolved notation');
      };
      let value = property.resolve(declaration?.custom ? declaration.value : property.initialValue, ValueStage.Computed, context);
      if (dependency.cyclic) value = property.initialValue;
      // https://drafts.csswg.org/css-values-5/#resolve-property
      // Substitution can itself produce a CSS-wide keyword, so default after replacement.
      const keyword = value.cssWideKeyword();
      if (!declaration?.custom || keyword === 'inherit' || keyword === 'unset') {
        const parent = this.#getInheritanceParent(element, scope);
        value = parent === null ? property.initialValue :
          this.#getComputedCustomValue(
            name, parent, scope, cascadedByElement, customValuesByElement, dependencyStack, customPropertyRegistry,
          );
      } else if (keyword === 'initial') {
        value = property.initialValue;
      } else if (keyword === 'revert' || keyword === 'revert-layer') {
        // TODO: Cascade rollback needs the earlier origin/layer candidates, not just this winner.
        throw new InternalError('Custom-property cascade rollback is not implemented');
      }
      computedValues.set(name, value);
      return value;
    } finally {
      dependencyStack.pop();
    }
  }

  /** Retain named records through inheritance without computing overridden parent values. */
  #getCustomProperties(
    element: Element,
    scope: TreeScope,
    cascadedByElement: Map<Element, CascadedProperties>,
  ): Map<CustomPropertyName, CustomProperty> {
    const parent = this.#getInheritanceParent(element, scope);
    const properties = parent === null ? new Map<CustomPropertyName, CustomProperty>() :
      this.#getCustomProperties(parent, scope, cascadedByElement);
    for (const { declaration } of this.#getCascadedDeclarations(element, scope, cascadedByElement).values()) {
      if (declaration.custom) properties.set(declaration.name, declaration.property);
    }
    return properties;
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
  environmentBaseUrl?: URLRecord;
  /** Explicit document registrations; stylesheet registrations are collected for each query. */
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
type BuiltInPropertyCache = {
  propertyValues: Map<BuiltInPropertyName, WholeValue>;
  shorthandExpansions: Map<
    PendingShorthand<Value>,
    WholeValue[] | null
  >;
};

/** Computed custom-property values belonging to one element in this query. */
type ComputedCustomValues = Map<CustomPropertyName, CustomPropertyValue>;

/** One active property dependency; every participant is marked when a name recurs on the same element. */
type CustomPropertyDependency = {
  element: Element;
  name: CustomPropertyName;
  cyclic: boolean;
};
