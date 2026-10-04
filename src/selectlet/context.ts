import type {
  DOMQueryRoot as QuerySource, DOMElement as Element, DOMDocument as Document, DOMOperations,
} from '../infra/index';
import { byClass, byId, byTag, byTagNs } from './api/lookup';
import { queryFirst, type DebugFirst, type FirstResolver } from './api/first';
import { buildSeedsByClass, type SeedClassFn } from './seeds/seedsByClass';
import { buildSeedsById, type SeedIdFn } from './seeds/seedsById';
import type {
  CustomPseudoPredicate, ElementList, SelectletConfig, SelectletErrorOptions,
} from './selectlet';
import { escapeRegExp } from '../infra/strings';
import { TextCursorError } from '../infra/text-cursor';
import { queryMatches, type DebugMatch, type MatchResolver } from './api/match';
import { queryClosest } from './api/closest';
import { describeQuerySource, describeElement } from './debug';
import { toNodeList } from './node-list';
import { RuntimeCache } from './compile/runtimeCache';

import { querySelect, type SelectResolver, type DebugSelect } from './api/select';
import type { SelectletEnvironment } from './environment';

/** Query state, compiled selectors, and caches shared by one Selectlet engine. */
export class SelectletContext {
  /** Existing host owner supplying DOM operations. */
  env: SelectletEnvironment;
  /** Document currently supplying query mode and namespace information. */
  doc: Document;
  /** Node supplying the current query. */
  source: QuerySource;
  /** Current document element, absent in empty and template-owner documents. */
  root: Element | null;
  /** Element used to evaluate :scope for the current query. */
  scopeEl: Element | null;

  isHtml: boolean;
  isQuirksMode: boolean;
  namespace: string | null;
  hasDocumentAll: boolean;
  hasTreeWalker: boolean;

  /** Engine-local query options, including result shape and cache limits. */
  config: SelectletConfig;
  /** Additional pseudo-class predicates registered by the caller. */
  pseudos: Record<string, CustomPseudoPredicate> = {};

  seedsById: SeedIdFn;
  seedsByClass: SeedClassFn;
  /** Operations selected from the supplied environment at engine construction. */
  dom: DOMOperations;

  checkCacheWatermark: () => void;

  matches: (sel: string, source: Element) => boolean;
  select: (sel: string, source?: QuerySource) => ElementList;
  first: (sel: string, source?: QuerySource) => Element | null;
  closest: (sel: string, source: Element) => Element | null;

  // state for dynamic pseudo-classes
  hoverTarget: Element | null = null;
  activeTarget: Element | null = null;
  focusTarget: Element | null = null;

  // cache
  strictMatchResolvers = new Map<string, MatchResolver>();
  selectResolvers = new Map<string, SelectResolver>();
  firstResolvers = new Map<string, FirstResolver>();
  cachedRegex_S = new Map<string, RegExp>();
  cachedRegex_I = new Map<string, RegExp>();
  classRegex_S = new Map<string, RegExp>();
  classRegex_I = new Map<string, RegExp>();
  tokenRegex_S = new Map<string, RegExp>();
  tokenRegex_I = new Map<string, RegExp>();

  selectWitnessResolvers = new Map<string, SelectResolver>();

  cacheSize = 0;

  runtimeCache = new RuntimeCache();

  // perf testing hooks
  probe = {
    select: 0,
    selBuild: 0,
    match: 0,
    matBuild: 0,
    first: 0,
    firstBuild: 0,
    reset: () => {
      this.probe.select = 0;
      this.probe.selBuild = 0;
      this.probe.match = 0;
      this.probe.matBuild = 0;
      this.probe.first = 0;
      this.probe.firstBuild = 0;
    },
  };

  // Debugging state for the current query and nested queries.
  isDebug = false;
  debugSelect: DebugSelect | undefined;
  debugMatch: DebugMatch | undefined;
  debugFirst: DebugFirst | undefined;
  debugStack: (DebugSelect | DebugFirst | DebugMatch)[] = [];
  debugCompile: string | undefined;

  constructor(
    doc: Document,
    config: SelectletConfig,
    errors: SelectletErrorOptions | undefined,
    env: SelectletEnvironment,
  ) {
    const dom = env.userAgent.dom;
    this.env = env;
    this.dom = dom;
    this.config = config;
    this.seedsById = buildSeedsById(this);
    this.seedsByClass = buildSeedsByClass(this);
    this.doc = doc;
    this.source = doc;
    this.root = dom.documentElement(doc);
    this.scopeEl = null;
    this.isHtml = dom.isHTMLDocument(doc);
    this.isQuirksMode = dom.isQuirksMode(doc);
    this.namespace = this.root ? dom.getNamespaceURI(this.root) : null;
    this.hasDocumentAll = dom.hasDocumentAll(doc);
    this.hasTreeWalker = dom.walkElements !== undefined;

    const watermark = config.CACHE_WATERMARK;
    this.checkCacheWatermark = watermark <= 0 || !Number.isFinite(watermark)
      ? () => {}
      : () => { if (this.cacheSize > watermark) this.clearCache(); };

    const syntax = errors?.syntax;
    if (syntax) {
      const wrapErr = (err: unknown): never => rethrowSelectorError(err, syntax);

      this.matches = (sel, source) => {
        try { return queryMatches(sel, source, this); }
        catch (err) { return wrapErr(err); }
      };

      this.first = (sel, source) => {
        try { return queryFirst(sel, source ?? this.doc, this); }
        catch (err) { return wrapErr(err); }
      };

      this.closest = (sel, source) => {
        try { return queryClosest(sel, source, this); }
        catch (err) { return wrapErr(err); }
      };

      this.select = config.NODE_LIST ?
        (sel, source) => {
          try { return toNodeList(querySelect(sel, source ?? this.doc, this)); }
          catch (err) { return wrapErr(err); }
        } :
        (sel, source) => {
          try { return querySelect(sel, source ?? this.doc, this); }
          catch (err) { return wrapErr(err); }
        };
    } else {
      this.matches = (sel, source) => queryMatches(sel, source, this);
      this.first = (sel, source) => queryFirst(sel, source ?? this.doc, this);
      this.closest = (sel, source) => queryClosest(sel, source, this);
      this.select = config.NODE_LIST ?
        (sel, source) => toNodeList(querySelect(sel, source ?? this.doc, this)) :
        (sel, source) => querySelect(sel, source ?? this.doc, this);
    }
  }

  /** Discard compiled queries and regular expressions after configuration changes. */
  clearCache(): void {
    this.cacheSize = 0;
    this.strictMatchResolvers.clear();
    this.selectResolvers.clear();
    this.firstResolvers.clear();
    this.cachedRegex_S.clear();
    this.cachedRegex_I.clear();
    this.classRegex_S.clear();
    this.classRegex_I.clear();
    this.tokenRegex_S.clear();
    this.tokenRegex_I.clear();
    this.selectWitnessResolvers.clear();
  }

  update(source: QuerySource, updateScope = false): void {
    // Among query roots, only a document has no owner document.
    const doc = (this.dom.ownerDocument(source) ?? source) as Document;

    if (this.doc !== doc) {
      // Template-content owner documents can have null documentElement
      // despite lib.dom typing Document#documentElement as non-null.
      const root = this.dom.documentElement(doc);

      this.doc = doc;
      this.root = root;
      this.isHtml = this.dom.isHTMLDocument(doc);
      this.isQuirksMode = this.dom.isQuirksMode(doc);
      this.namespace = root ? this.dom.getNamespaceURI(root) : null;
      this.hasDocumentAll = this.dom.hasDocumentAll(doc);
      this.hasTreeWalker = this.dom.walkElements !== undefined;
    }

    this.source = source;

    if (updateScope) {
      this.scopeEl = this.dom.isDocument(source) ? this.root : this.dom.isElement(source) ? source : null;
    }
  }

  getCachedRegex(source: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase ? this.cachedRegex_I : this.cachedRegex_S;

    let regex = cache.get(source);
    if (regex !== undefined) return regex;

    regex = new RegExp(source, ignoreCase ? 'i' : '');
    cache.set(source, regex);
    this.cacheSize++;
    return regex;
  }

  getClassRegex(cls: string): RegExp {
    const cache = this.isQuirksMode ? this.classRegex_I : this.classRegex_S;

    let regex = cache.get(cls);
    if (regex !== undefined) return regex;

    regex = new RegExp(`(^|[\\t\\n\\f\\r ])${escapeRegExp(cls)}([\\t\\n\\f\\r ]|$)`, this.isQuirksMode ? 'i' : '');
    cache.set(cls, regex);
    this.cacheSize++;
    return regex;
  }

  getCssTokenRegex(token: string, ignoreCase: boolean): RegExp {
    const cache = ignoreCase ? this.tokenRegex_I : this.tokenRegex_S;

    let regex = cache.get(token);
    if (regex !== undefined) return regex;

    regex = new RegExp(
      `(^|[\\t\\n\\f\\r ])${escapeRegExp(token)}([\\t\\n\\f\\r ]|$)`,
      ignoreCase ? 'i' : '',
    );

    cache.set(token, regex);
    this.cacheSize++;
    return regex;
  }

  syncRuntimeCache(source: QuerySource): void {
    this.runtimeCache.sync(this.dom.treeVersion?.(source));
  }

  // public API methods
  byId(id: string, source?: QuerySource) {
    return byId(id, source ?? this.doc, this);
  }

  byTag(tag: string, source?: QuerySource) {
    return byTag(tag, source ?? this.doc, this);
  }

  byTagNs(ns: string | null, local: string, source?: QuerySource) {
    return byTagNs(ns, local, source ?? this.doc, this);
  }

  byClass(cls: string, source?: QuerySource) {
    return byClass(cls, source ?? this.doc, this);
  }

  setDebug(enabled: boolean): void {
    this.isDebug = enabled;
    if (enabled) this.clearDebug();
  }

  clearDebug(): void {
    this.debugSelect = undefined;
    this.debugMatch = undefined;
    this.debugFirst = undefined;
    this.debugStack.length = 0;
    this.debugCompile = undefined;
  }

  printDebug(): string {
    const docDesc = describeQuerySource(this.doc, undefined, this.dom);
    const sourceDesc = describeQuerySource(this.source, undefined, this.dom);
    return JSON.stringify({
      context: {
        isHtml: this.isHtml,
        isQuirksMode: this.isQuirksMode,
        namespace: this.namespace,
        doc: docDesc,
        source: this.source === this.doc ? '(same as doc)' : sourceDesc,
        scopeEl: this.scopeEl ? describeElement(this.scopeEl, this.dom) : null,
        root: { summary: describeElement(this.root, this.dom) },
      },
      debugStack: this.debugStack,
    }, null, 2);
  }

}

function rethrowSelectorError(
  err: unknown,
  syntax: (err: SyntaxError) => Error
): never {
  if (err instanceof TextCursorError) {
    throw syntax(err);
  }

  throw err;
}
