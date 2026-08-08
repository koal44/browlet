import type {
  CustomPropertyName, CustomPropertyRegistration, CustomPropertyRegistry,
  PropertyContext, PropertyDeclaration,
} from '../css/property';
import { createTreeScope, type TreeScope } from '../css/tree-scope';
import type { StyleSheet } from '../css/stylesheet';
import {
  getCascadedProperty as findCascadedProperty, type CascadedProperty,
} from './cascade';
import {
  getCustomPropertyRegistration as findCustomPropertyRegistration,
} from './custom-property';
import type { StyleSheetAssociation } from './stylesheet-association';

export class StyleEngine {
  readonly #activeStyleSheets: StyleSheetAssociation[] = [];

  // A stand-in for the associated Document's [[registeredPropertySet]],
  // pending integration with a document layer.
  readonly registeredPropertySet: CustomPropertyRegistry;

  // The API base URL of the document-like environment associated with this
  // engine. It is the final fallback for resolving stylesheet resource URLs.
  readonly environmentBaseUrl: URL | undefined;

  // The document-like scope associated with this engine. Callers can supply
  // another scope when the same stylesheet is active in a shadow tree.
  readonly treeScope: TreeScope;

  constructor(options: StyleEngineOptions = {}) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map();
    this.environmentBaseUrl = options.environmentBaseUrl;
    this.treeScope = options.treeScope ?? createTreeScope();
  }

  // The document's active stylesheet associations, in document order.
  get activeStyleSheets(): readonly StyleSheetAssociation[] {
    return this.#activeStyleSheets;
  }

  addStyleSheet(
    styleSheet: StyleSheet,
    treeScope: TreeScope = this.treeScope,
  ): StyleSheetAssociation {
    const association = { styleSheet, treeScope };
    this.#activeStyleSheets.push(association);
    return association;
  }

  getCascadedProperty(
    name: PropertyDeclaration['name'],
    treeScope: TreeScope = this.treeScope,
  ): CascadedProperty | null {
    return findCascadedProperty(this, name, treeScope);
  }

  getPropertyContext(property: CascadedProperty): PropertyContext {
    const { styleSheet, treeScope } = property.association;
    const baseUrl = styleSheet.baseUrl ??
      styleSheet.location ??
      this.environmentBaseUrl;

    return {
      treeScope,
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  }

  getCustomPropertyRegistration(
    name: CustomPropertyName,
  ): CustomPropertyRegistration | null {
    return findCustomPropertyRegistration(this, name);
  }
}

export type StyleEngineOptions = {
  environmentBaseUrl?: URL;
  registeredPropertySet?: CustomPropertyRegistry;
  treeScope?: TreeScope;
};
