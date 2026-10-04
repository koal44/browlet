import { escapeRegExp } from '../infra/strings';
import type {
  DOMOperations, DOMDocument as Document, DOMElement as Element, DOMNode as Node,
} from '../infra/index';
import { RuntimeCache } from './selector/runtimeCache';
import { defaultStyleletEnvironment, type StyleletEnvironment } from './environment';

export class StyleletContext {
  document: Document;
  isHtml: boolean;
  env: StyleletEnvironment;

  dom: DOMOperations;

  hoverTarget: Element | null = null;
  activeTarget: Element | null = null;
  focusTarget: Element | null = null;

  runtimeCache = new RuntimeCache();

  #compiledSelectors = new WeakMap<object, unknown>();
  #caseSensitiveRegexes = new Map<string, RegExp>();
  #caseInsensitiveRegexes = new Map<string, RegExp>();
  #caseSensitiveClassRegexes = new Map<string, RegExp>();
  #caseInsensitiveClassRegexes = new Map<string, RegExp>();
  #caseSensitiveTokenRegexes = new Map<string, RegExp>();
  #caseInsensitiveTokenRegexes = new Map<string, RegExp>();

  constructor(document: Document, env: StyleletEnvironment = defaultStyleletEnvironment) {
    this.env = env;
    this.dom = env.userAgent.dom;
    this.document = document;
    this.isHtml = this.dom.isHTMLDocument(document);
  }

  get root(): Element | null {
    return this.dom.documentElement(this.document);
  }

  get isQuirksMode(): boolean {
    return this.dom.isQuirksMode(this.document);
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
    if (!this.dom.treeVersion) return null;

    this.runtimeCache.sync(this.dom.treeVersion(root));
    return this.runtimeCache;
  }
}

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
