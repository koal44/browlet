import { escapeRegExp } from '../infra/strings';
import type {
  DOMOperations, DOMDocument as Document, DOMElement as Element, DOMNode as Node,
} from '../infra/index';

import type { StyleletEnvironment } from './environment';
import { RuntimeCache } from './selector/index';

/** Document-specific selector state, host DOM access, and reusable matching caches. */
export class StyleletContext {
  /** Document whose modes and tree are used for style matching. */
  document: Document;
  /** Whether selector matching uses HTML document rules. */
  isHtml: boolean;
  /** Owning environment supplying execution and host facilities. */
  env: StyleletEnvironment;

  /** Host-neutral operations for inspecting this document's nodes. */
  dom: DOMOperations;

  /** Current host-supplied pointer target used by :hover matching. */
  hoverTarget: Element | null = null;
  /** Current host-supplied activation target used by :active matching. */
  activeTarget: Element | null = null;
  /** Current host-supplied focused element used by focus selectors. */
  focusTarget: Element | null = null;

  /** Sibling-position caches invalidated by the host's tree version. */
  runtimeCache = new RuntimeCache();

  /** Compiled selector programs indexed by their parsed selector records. */
  #compiledSelectors = new WeakMap<object, unknown>();
  /** Exact-case regular expressions indexed by pattern text. */
  #caseSensitiveRegexes = new Map<string, RegExp>();
  /** Case-insensitive regular expressions indexed by pattern text. */
  #caseInsensitiveRegexes = new Map<string, RegExp>();
  /** Class-token matchers for documents outside quirks mode. */
  #caseSensitiveClassRegexes = new Map<string, RegExp>();
  /** Class-token matchers used by quirks-mode selector matching. */
  #caseInsensitiveClassRegexes = new Map<string, RegExp>();
  /** Exact-case matchers for tokens separated by CSS whitespace. */
  #caseSensitiveTokenRegexes = new Map<string, RegExp>();
  /** Case-insensitive matchers for tokens separated by CSS whitespace. */
  #caseInsensitiveTokenRegexes = new Map<string, RegExp>();

  /** Establish the document's selector modes and the host operations that inspect it. */
  constructor(document: Document, env: StyleletEnvironment) {
    this.env = env;
    this.dom = env.userAgent.dom;
    this.document = document;
    this.isHtml = this.dom.isHTMLDocument(document);
  }

  /** Current document element, or null when the document has none. */
  get root(): Element | null {
    return this.dom.documentElement(this.document);
  }

  /** Whether the document currently requires quirks-mode selector behavior. */
  get isQuirksMode(): boolean {
    return this.dom.isQuirksMode(this.document);
  }

  /** Retrieve a selector's compiled program using the type supplied by its compiler. */
  getCompiledSelector<T>(selector: object): T | undefined {
    return this.#compiledSelectors.get(selector) as T | undefined;
  }

  /** Retain a compiled program for its parsed selector and return that program. */
  setCompiledSelector<T>(selector: object, compiled: T): T {
    this.#compiledSelectors.set(selector, compiled);
    return compiled;
  }

  /** Reuse a pattern with the requested case sensitivity. */
  getCachedRegex(source: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase
      ? this.#caseInsensitiveRegexes
      : this.#caseSensitiveRegexes;
    return getOrCreateRegex(cache, source, ignoreCase);
  }

  /** Match one class token using the document's case-sensitivity rules. */
  getClassRegex(className: string): RegExp {
    const cache = this.isQuirksMode
      ? this.#caseInsensitiveClassRegexes
      : this.#caseSensitiveClassRegexes;
    const source = `(^|[\\t\\n\\f\\r ])${escapeRegExp(className)}([\\t\\n\\f\\r ]|$)`;
    return getOrCreateRegex(cache, source, this.isQuirksMode);
  }

  /** Match a whole CSS-whitespace-separated token with the requested case sensitivity. */
  getCssTokenRegex(token: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase
      ? this.#caseInsensitiveTokenRegexes
      : this.#caseSensitiveTokenRegexes;
    const source = `(^|[\\t\\n\\f\\r ])${escapeRegExp(token)}([\\t\\n\\f\\r ]|$)`;
    return getOrCreateRegex(cache, source, ignoreCase);
  }

  /** Discard compiled selectors, regular expressions, and cached sibling positions. */
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

  /** Refresh caches for this tree version, or disable reuse when the host cannot track mutations. */
  syncRuntimeCache(root: Node): RuntimeCache | null {
    if (!this.dom.treeVersion) return null;

    this.runtimeCache.sync(this.dom.treeVersion(root));
    return this.runtimeCache;
  }
}

/** Reuse a compiled pattern within a cache dedicated to one matching mode. */
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
