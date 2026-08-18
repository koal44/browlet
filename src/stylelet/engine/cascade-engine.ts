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
import type { TreeScope } from './tree-scope';

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
    scope: TreeScope,
  ): IterableIterator<CSSStyleSheetImpl> {
    for (const styleSheet of scope.finalStyleSheets()) {
      if (!styleSheet.disabled) yield styleSheet;
    }
  }

  getComputedStyle(
    element: Element,
    scope: TreeScope,
  ): CSSStyleDeclaration {
    return computeStyle(this, element, scope);
  }

  getCascadedProperty(
    name: PropertyDeclaration['name'],
    scope: TreeScope,
  ): CascadedProperty | null {
    return findCascadedProperty(this, name, scope);
  }

  getCascadedPropertyForElement(
    name: PropertyDeclaration['name'],
    element: Element,
    scope: TreeScope,
  ): CascadedProperty | null {
    return findCascadedProperty(
      this,
      name,
      scope,
      element,
    );
  }

  getPropertyContext(property: CascadedProperty): PropertyContext {
    const { styleSheet, scope } = property;
    const interpretedStyleSheet = styleSheet.__interpretedStyleSheet;
    const baseUrl = interpretedStyleSheet.baseUrl ??
      interpretedStyleSheet.location ??
      this.environmentBaseUrl;

    return {
      treeScope: scope,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  getCustomPropertyRegistration(
    name: CustomPropertyName,
    scope: TreeScope,
  ): CustomPropertyRegistration | null {
    return findCustomPropertyRegistration(this, name, scope);
  }
}

export type CascadeEngineOptions = {
  environmentBaseUrl?: URL;
  registeredPropertySet?: CustomPropertyRegistry;
  snapshot: Snapshot;
};
