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

/** Select declarations from a tree scope and retain the document context used to resolve them. */
export class CascadeEngine {
  /** Document-wide custom-property registrations, pending integration with the document's registry. */
  registeredPropertySet: CustomPropertyRegistry;

  /** Document API base URL used when a declaration's stylesheet supplies neither a base nor a location. */
  environmentBaseUrl: StyleletURL | undefined;

  /** Owning document's matching state and host facilities. */
  context: StyleletContext;

  /** Retain the document context, fallback URL base, and optional registration map. */
  constructor(options: CascadeEngineOptions) {
    this.registeredPropertySet = options.registeredPropertySet ?? new Map();
    this.environmentBaseUrl = options.environmentBaseUrl;
    this.context = options.context;
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
  getComputedStyle(
    element: Element,
    scope: TreeScope,
  ): CSSStyleDeclarationImpl {
    return computeStyle(this, element, scope);
  }

  /** Select a property without an element, treating selector specificity as zero. */
  getCascadedProperty(
    name: PropertyDeclaration['name'],
    scope: TreeScope,
  ): CascadedProperty | null {
    return findCascadedProperty(this, name, scope);
  }

  /** Select a property from rules matching this element in the supplied scope. */
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

  /** Recover a selected declaration's URL base and tree scope for value resolution. */
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

  /** Find a document registration or the last applicable @property registration in the scope. */
  getCustomPropertyRegistration(
    name: CustomPropertyName,
    scope: TreeScope,
  ): CustomPropertyRegistration | null {
    return findCustomPropertyRegistration(this, name, scope);
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
