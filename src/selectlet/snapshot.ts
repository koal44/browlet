import { byClass, byId, byTag, byTagNs } from './api/lookup';
import { queryFirst, type DebugFirst, type FirstResolver } from './api/first';
import { buildSeedsByClass, type SeedClassFn } from './seeds/seedsByClass';
import { buildSeedsById, type SeedIdFn } from './seeds/seedsById';
import type {
  CustomPseudoPredicate, ElementList, HtmlCollectionArray, QueryContext, SelectletCaps, SelectletConfig, SelectletErrorOptions,
} from './selectlet';
import { escapeRegExp } from '../shared/css';
import { isDocument, isElement, isHtmlDoc, isQuirksMode } from '../shared/dom';
import { HTML_NAMESPACE } from '../shared/namespaces';
import { TextCursorError } from '../shared/text-cursor';
import { queryMatches, type DebugMatch, type MatchResolver } from './api/match';
import { queryClosest } from './api/closest';
import { describeContext, describeElement } from './debug';
import { toNodeList } from './node-list';
import { RuntimeCache } from './compile/runtimeCache';

import { querySelect, type SelectResolver, type DebugSelect } from './api/select';

export class Snapshot {
  doc: Document;
  from: QueryContext;
  root: Element | null;
  scopeEl: Element | null;

  isHtml: boolean;
  isQuirksMode: boolean;
  namespace: string | null;
  hasDocumentAll: boolean;
  hasTreeWalker: boolean;

  config: SelectletConfig;
  pseudos: Record<string, CustomPseudoPredicate> = {};

  // caps
  seedsById: SeedIdFn;
  seedsByClass: SeedClassFn;
  readonly docDesignMode: (doc: Document) => string | undefined;
  readonly treeVersion: (ctx: QueryContext) => number | undefined;
  readonly hasTreeVersion: boolean;
  readonly htmlCollectionArray: HtmlCollectionArray | undefined;
  hasCustomState: (e: Element, name: string) => boolean;

  checkCacheWatermark: () => void;

  matches: (sel: string, context: Element) => boolean;
  select: (sel: string, context?: QueryContext) => ElementList;
  first: (sel: string, context?: QueryContext) => Element | null;
  closest: (sel: string, context: Element) => Element | null;

  getId: (e: Element) => string;
  getClass: (e: Element) => string;
  getLocalName: (e: Element) => string;
  getNamespaceURI: (e: Element) => string | null;

  getAttribute: (e: Element, name: string) => string | null;
  getAttributeNS: (e: Element, namespace: string | null, localName: string) => string | null;
  hasAttribute: (e: Element, name: string) => boolean;
  hasAttributeNS: (e: Element, namespace: string | null, localName: string) => boolean;

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

  constructor(doc: Document, config: SelectletConfig, caps?: Partial<SelectletCaps>, errors?: SelectletErrorOptions) {
    const root = doc.documentElement as Element | null;

    this.config = config;

    this.seedsById = buildSeedsById(caps, this);
    this.seedsByClass = buildSeedsByClass(caps, this);
    this.docDesignMode = caps?.doc?.designMode ?? ((doc) => doc.designMode);
    this.treeVersion = caps?.tree?.treeVersion ?? defaultTreeVersion;
    this.hasTreeVersion = caps?.tree?.treeVersion !== undefined;
    this.htmlCollectionArray = caps?.htmlCollectionArray;

    this.doc = doc;
    this.from = doc;
    this.root = root;
    this.scopeEl = null;

    this.isHtml = isHtmlDoc(doc);
    this.isQuirksMode = isQuirksMode(doc);
    this.namespace = root?.namespaceURI ?? null;
    this.hasDocumentAll = 'all' in doc;
    this.hasTreeWalker = 'createTreeWalker' in doc;

    const watermark = config.CACHE_WATERMARK;
    this.checkCacheWatermark = watermark <= 0 || !Number.isFinite(watermark)
      ? () => {}
      : () => { if (this.cacheSize > watermark) this.clearCache(); };

    const elCaps = caps?.el;

    this.getId = elCaps?.getId ?? getIdAttr;
    this.getClass = elCaps?.getClass ?? getClassAttr;
    this.getLocalName = elCaps?.getLocalName ?? defaultGetLocalName;
    this.getNamespaceURI = elCaps?.getNamespaceURI ?? defaultGetNamespaceURI;
    this.getAttribute = elCaps?.getAttribute ?? defaultGetAttribute;
    this.getAttributeNS = elCaps?.getAttributeNS ?? defaultGetAttributeNS;
    this.hasAttribute = elCaps?.hasAttribute ?? defaultHasAttribute;
    this.hasAttributeNS = elCaps?.hasAttributeNS ?? defaultHasAttributeNS;
    this.hasCustomState = elCaps?.hasCustomState ?? defaultHasCustomState;

    const syntax = errors?.syntax;
    if (syntax) {
      const wrapErr = (err: unknown): never => rethrowSelectorError(err, syntax);

      this.matches = (sel, context) => {
        try { return queryMatches(sel, context, this); }
        catch (err) { return wrapErr(err); }
      };

      this.first = (sel, context) => {
        try { return queryFirst(sel, context ?? this.doc, this); }
        catch (err) { return wrapErr(err); }
      };

      this.closest = (sel, context) => {
        try { return queryClosest(sel, context, this); }
        catch (err) { return wrapErr(err); }
      };

      this.select = config.NODE_LIST ?
        (sel, context) => {
          try { return toNodeList(querySelect(sel, context ?? this.doc, this), this.doc); }
          catch (err) { return wrapErr(err); }
        } :
        (sel, context) => {
          try { return querySelect(sel, context ?? this.doc, this); }
          catch (err) { return wrapErr(err); }
        };
    } else {
      this.matches = (sel, context) => queryMatches(sel, context, this);
      this.first = (sel, context) => queryFirst(sel, context ?? this.doc, this);
      this.closest = (sel, context) => queryClosest(sel, context, this);
      this.select = config.NODE_LIST ?
        (sel, context) => toNodeList(querySelect(sel, context ?? this.doc, this), this.doc) :
        (sel, context) => querySelect(sel, context ?? this.doc, this);
    }
  }

  update(ctx: QueryContext, updateScope = false): void {
    const doc = ctx.ownerDocument ?? ctx;

    if (this.doc !== doc) {
      // Template-content owner documents can have null documentElement
      // despite lib.dom typing Document#documentElement as non-null.
      const root = doc.documentElement as Element | null;

      this.doc = doc;
      this.root = root;
      this.isHtml = isHtmlDoc(doc);
      this.isQuirksMode = isQuirksMode(doc);
      this.namespace = root ? root.namespaceURI : null;
      this.hasDocumentAll = 'all' in doc;
      this.hasTreeWalker = 'createTreeWalker' in doc;
    }

    this.from = ctx;

    if (updateScope) {
      this.scopeEl = isDocument(ctx) ? this.root : isElement(ctx) ? ctx : null;
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

  syncRuntimeCache(ctx: QueryContext): void {
    this.runtimeCache.sync(this.treeVersion(ctx));
  }

  // public API methods
  byId(id: string, context?: QueryContext) {
    return byId(id, context ?? this.doc, this);
  }

  byTag(tag: string, context?: QueryContext) {
    return byTag(tag, context ?? this.doc, this);
  }

  byTagNs(ns: string | null, local: string, context?: QueryContext) {
    return byTagNs(ns, local, context ?? this.doc, this);
  }

  byClass(cls: string, context?: QueryContext) {
    return byClass(cls, context ?? this.doc, this);
  }

  // -------- Runtime matchers used by emitted selector functions --------

  isHtmlElement(e: Element): e is HTMLElement {
    return this.getNamespaceURI(e) === HTML_NAMESPACE;
  }

  // debugging
  isDebug = false;
  debugSelect: DebugSelect | undefined;
  debugMatch: DebugMatch | undefined;
  debugFirst: DebugFirst | undefined;
  debugStack: (DebugSelect | DebugFirst | DebugMatch)[] = [];
  debugCompile: string | undefined;

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
    const docDesc = describeContext(this.doc);
    const fromDesc = describeContext(this.from);
    return JSON.stringify({
      snapshot: {
        isHtml: this.isHtml,
        isQuirksMode: this.isQuirksMode,
        namespace: this.namespace,
        doc: docDesc,
        from: this.from === this.doc ? '(same as doc)' : fromDesc,
        scopeEl: this.scopeEl ? describeElement(this.scopeEl) : null,
        root: { summary: describeElement(this.root) },
      },
      debugStack: this.debugStack,
    }, null, 2);
  }

}

function getIdAttr(e: Element): string {
  const v = e.id;
  return typeof v === 'string' ? v : e.getAttribute('id') || '';
}

function getClassAttr(e: Element): string {
  const v = e.className;
  return typeof v === 'string' ? v : e.getAttribute('class') || '';
}

function defaultGetLocalName(e: Element): string {
  return e.localName;
}

function defaultGetNamespaceURI(e: Element): string | null {
  return e.namespaceURI;
}

function defaultGetAttribute(e: Element, name: string): string | null {
  return e.getAttribute(name);
}

function defaultGetAttributeNS(e: Element, namespace: string | null, localName: string): string | null {
  return e.getAttributeNS(namespace, localName);
}

function defaultHasAttribute(e: Element, name: string): boolean {
  return e.hasAttribute(name);
}

function defaultHasAttributeNS(e: Element, namespace: string | null, localName: string): boolean {
  return e.hasAttributeNS(namespace, localName);
}

function defaultTreeVersion(_ctx: QueryContext): number | undefined {
  return undefined;
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

function defaultHasCustomState(_e: Element, _name: string): boolean {
  return false;
}
