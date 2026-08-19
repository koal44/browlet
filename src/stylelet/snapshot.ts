import { escapeRegExp } from '../shared/css';
import { HTML_NAMESPACE } from '../shared/namespaces';
import { RuntimeCache } from './selector/runtimeCache';

export class Snapshot {
  readonly document: Document;
  readonly isHtml: boolean;
  readonly options: Readonly<SnapshotOptions>;

  readonly documentDesignMode: (document: Document) => string | undefined;
  readonly treeVersion: (root: Node) => number | undefined;
  readonly hasTreeVersion: boolean;

  readonly getId: (element: Element) => string;
  readonly getClass: (element: Element) => string;
  readonly getLocalName: (element: Element) => string;
  readonly getNamespaceURI: (element: Element) => string | null;
  readonly getAttribute: (element: Element, name: string) => string | null;
  readonly getAttributeNS: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => string | null;
  readonly hasAttribute: (element: Element, name: string) => boolean;
  readonly hasAttributeNS: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => boolean;
  readonly hasCustomState: (element: Element, name: string) => boolean;

  hoverTarget: Element | null = null;
  activeTarget: Element | null = null;
  focusTarget: Element | null = null;

  readonly runtimeCache = new RuntimeCache();

  #compiledSelectors = new WeakMap<object, unknown>();
  readonly #caseSensitiveRegexes = new Map<string, RegExp>();
  readonly #caseInsensitiveRegexes = new Map<string, RegExp>();
  readonly #caseSensitiveClassRegexes = new Map<string, RegExp>();
  readonly #caseInsensitiveClassRegexes = new Map<string, RegExp>();
  readonly #caseSensitiveTokenRegexes = new Map<string, RegExp>();
  readonly #caseInsensitiveTokenRegexes = new Map<string, RegExp>();

  constructor(document: Document, options: SnapshotOptions = {}) {
    const { caps = {} } = options;
    const documentCaps = caps.document;
    const elementCaps = caps.element;
    const treeCaps = caps.tree;

    this.document = document;
    this.isHtml = document.contentType.includes('/html');
    this.options = options;

    this.documentDesignMode = documentCaps?.designMode ?? defaultDocumentDesignMode;
    this.treeVersion = treeCaps?.version ?? defaultTreeVersion;
    this.hasTreeVersion = treeCaps?.version !== undefined;

    this.getId = elementCaps?.getId ?? defaultGetId;
    this.getClass = elementCaps?.getClass ?? defaultGetClass;
    this.getLocalName = elementCaps?.getLocalName ?? defaultGetLocalName;
    this.getNamespaceURI = elementCaps?.getNamespaceURI ?? defaultGetNamespaceURI;
    this.getAttribute = elementCaps?.getAttribute ?? defaultGetAttribute;
    this.getAttributeNS = elementCaps?.getAttributeNS ?? defaultGetAttributeNS;
    this.hasAttribute = elementCaps?.hasAttribute ?? defaultHasAttribute;
    this.hasAttributeNS = elementCaps?.hasAttributeNS ?? defaultHasAttributeNS;
    this.hasCustomState = elementCaps?.hasCustomState ?? defaultHasCustomState;
  }

  get root(): Element | null {
    return this.document.documentElement;
  }

  get isQuirksMode(): boolean {
    return this.document.compatMode !== 'CSS1Compat';
  }

  getCompiledSelector<T>(selector: object): T | undefined {
    return this.#compiledSelectors.get(selector) as T | undefined;
  }

  setCompiledSelector<T>(selector: object, compiled: T): T {
    this.#compiledSelectors.set(selector, compiled);
    return compiled;
  }

  getCachedRegex(source: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase
      ? this.#caseInsensitiveRegexes
      : this.#caseSensitiveRegexes;
    return getOrCreateRegex(cache, source, ignoreCase);
  }

  getClassRegex(className: string): RegExp {
    const cache = this.isQuirksMode
      ? this.#caseInsensitiveClassRegexes
      : this.#caseSensitiveClassRegexes;
    const source = `(^|[\\t\\n\\f\\r ])${escapeRegExp(className)}([\\t\\n\\f\\r ]|$)`;
    return getOrCreateRegex(cache, source, this.isQuirksMode);
  }

  getCssTokenRegex(token: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase
      ? this.#caseInsensitiveTokenRegexes
      : this.#caseSensitiveTokenRegexes;
    const source = `(^|[\\t\\n\\f\\r ])${escapeRegExp(token)}([\\t\\n\\f\\r ]|$)`;
    return getOrCreateRegex(cache, source, ignoreCase);
  }

  clearCaches(): void {
    this.#compiledSelectors = new WeakMap();
    this.#caseSensitiveRegexes.clear();
    this.#caseInsensitiveRegexes.clear();
    this.#caseSensitiveClassRegexes.clear();
    this.#caseInsensitiveClassRegexes.clear();
    this.#caseSensitiveTokenRegexes.clear();
    this.#caseInsensitiveTokenRegexes.clear();
    this.runtimeCache.clear();
  }

  syncRuntimeCache(root: Node): RuntimeCache | null {
    if (!this.hasTreeVersion) return null;

    this.runtimeCache.sync(this.treeVersion(root));
    return this.runtimeCache;
  }

  isHtmlElement(element: Element): element is HTMLElement {
    return this.getNamespaceURI(element) === HTML_NAMESPACE;
  }
}

export type SnapshotOptions = {
  caps?: StyleletCaps;
};

export type StyleletCaps = {
  document?: DocumentCaps;
  element?: ElementCaps;
  tree?: TreeCaps;
};

export type DocumentCaps = {
  designMode?: (document: Document) => string | undefined;
};

export type ElementCaps = {
  getId?: (element: Element) => string;
  getClass?: (element: Element) => string;
  getLocalName?: (element: Element) => string;
  getNamespaceURI?: (element: Element) => string | null;
  getAttribute?: (element: Element, name: string) => string | null;
  getAttributeNS?: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => string | null;
  hasAttribute?: (element: Element, name: string) => boolean;
  hasAttributeNS?: (
    element: Element,
    namespace: string | null,
    localName: string,
  ) => boolean;
  hasCustomState?: (element: Element, name: string) => boolean;
};

export type TreeCaps = {
  version?: (root: Node) => number | undefined;
};

function getOrCreateRegex(
  cache: Map<string, RegExp>,
  source: string,
  ignoreCase: boolean,
): RegExp {
  let regex = cache.get(source);
  if (regex !== undefined) return regex;

  regex = new RegExp(source, ignoreCase ? 'i' : '');
  cache.set(source, regex);
  return regex;
}

function defaultDocumentDesignMode(document: Document): string | undefined {
  return document.designMode;
}

function defaultTreeVersion(_root: Node): number | undefined {
  return undefined;
}

function defaultGetId(element: Element): string {
  const id = element.id;
  return typeof id === 'string' ? id : element.getAttribute('id') ?? '';
}

function defaultGetClass(element: Element): string {
  const className = element.className;
  return typeof className === 'string'
    ? className
    : element.getAttribute('class') ?? '';
}

function defaultGetLocalName(element: Element): string {
  return element.localName;
}

function defaultGetNamespaceURI(element: Element): string | null {
  return element.namespaceURI;
}

function defaultGetAttribute(element: Element, name: string): string | null {
  return element.getAttribute(name);
}

function defaultGetAttributeNS(
  element: Element,
  namespace: string | null,
  localName: string,
): string | null {
  return element.getAttributeNS(namespace, localName);
}

function defaultHasAttribute(element: Element, name: string): boolean {
  return element.hasAttribute(name);
}

function defaultHasAttributeNS(
  element: Element,
  namespace: string | null,
  localName: string,
): boolean {
  return element.hasAttributeNS(namespace, localName);
}

function defaultHasCustomState(_element: Element, _name: string): boolean {
  return false;
}
