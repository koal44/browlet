import type {
  CustomPropertyName, CustomPropertyRegistration, CustomPropertyRegistry,
  PropertyContext, PropertyDeclaration,
} from '../css/property';
import { CSSStyleSheetImpl } from '../cssom/css-stylesheet';
import type { Snapshot } from '../snapshot';
import { computeStyle } from './computed-style';
import {
  getCascadedProperty as findCascadedProperty, type CascadedProperty,
} from './cascade';
import {
  getCustomPropertyRegistration as findCustomPropertyRegistration,
} from './custom-property';
import type { DocumentOrShadowRootStyleState } from './document-or-shadow-root';

export class CascadeEngine {
  // A stand-in for the associated Document's [[registeredPropertySet]],
  // pending integration with a document layer.
  readonly registeredPropertySet: CustomPropertyRegistry;

  // The API base URL of the document-like environment associated with this
  // engine. It is the final fallback for resolving stylesheet resource URLs.
  readonly environmentBaseUrl: URL | undefined;

  readonly snapshot: Snapshot;

  constructor(options: CascadeEngineOptions) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map();
    this.environmentBaseUrl = options.environmentBaseUrl;
    this.snapshot = options.snapshot;
  }

  createStyleSheet(options: CSSStyleSheetInit = {}): CSSStyleSheet {
    return new CSSStyleSheetImpl(this.snapshot, options);
  }

  *getActiveStyleSheets(
    state: DocumentOrShadowRootStyleState,
  ): IterableIterator<CSSStyleSheetImpl> {
    for (const styleSheet of state.finalStyleSheets()) {
      if (!styleSheet.disabled) yield styleSheet;
    }
  }

  getComputedStyle(
    element: Element,
    state: DocumentOrShadowRootStyleState,
  ): CSSStyleDeclaration {
    return computeStyle(this, element, state);
  }

  getCascadedProperty(
    name: PropertyDeclaration['name'],
    state: DocumentOrShadowRootStyleState,
  ): CascadedProperty | null {
    return findCascadedProperty(this, name, state);
  }

  getCascadedPropertyForElement(
    name: PropertyDeclaration['name'],
    element: Element,
    state: DocumentOrShadowRootStyleState,
  ): CascadedProperty | null {
    return findCascadedProperty(
      this,
      name,
      state,
      element,
    );
  }

  getPropertyContext(property: CascadedProperty): PropertyContext {
    const { styleSheet, scope } = property;
    const semanticStyleSheet = styleSheet.__styleSheet;
    const baseUrl = semanticStyleSheet.baseUrl ??
      semanticStyleSheet.location ??
      this.environmentBaseUrl;

    return {
      treeScope: scope,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  getCustomPropertyRegistration(
    name: CustomPropertyName,
    state: DocumentOrShadowRootStyleState,
  ): CustomPropertyRegistration | null {
    return findCustomPropertyRegistration(this, name, state);
  }
}

export type CascadeEngineOptions = {
  environmentBaseUrl?: URL;
  registeredPropertySet?: CustomPropertyRegistry;
  snapshot: Snapshot;
};
