import type { DOMElement as Element } from '../../infra/index';

import type { StyleletURL } from '../environment';
import type { StyleletContext } from '../context';
import type {
  CustomPropertyName, CustomPropertyRegistration, CustomPropertyRegistry, PropertyContext,
  PropertyDeclaration,
} from '../css/index';
import { CSSStyleSheetImpl, type CSSStyleDeclarationImpl, type CSSStyleSheetInit } from '../cssom/index';

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
  registeredPropertySet: CustomPropertyRegistry;

  // The API base URL of the document-like environment associated with this
  // engine. It is the final fallback for resolving stylesheet resource URLs.
  environmentBaseUrl: StyleletURL | undefined;

  context: StyleletContext;

  constructor(options: CascadeEngineOptions) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map();
    this.environmentBaseUrl = options.environmentBaseUrl;
    this.context = options.context;
  }

  createStyleSheet(options: CSSStyleSheetInit = {}): CSSStyleSheetImpl {
    return new CSSStyleSheetImpl(this.context, options);
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
  ): CSSStyleDeclarationImpl {
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
    const baseUrl = styleSheet.baseURL ??
      styleSheet.location ??
      this.environmentBaseUrl;

    return {
      URL: this.context.env.userAgent.URL,
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
  environmentBaseUrl?: StyleletURL;
  registeredPropertySet?: CustomPropertyRegistry;
  context: StyleletContext;
};
