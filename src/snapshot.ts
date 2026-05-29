import { byClass, byId, byTag, byTagNs } from './api/lookup';
import {
  queryClosest, queryFirst, queryMatch, matchStrict, querySelect, type MatchResolver, type SelectResolver,
} from './api/query';
import { buildSeedsByClass, type SeedClassFn } from './candidates/seedsByClass';
import { buildSeedsById, type SeedIdFn } from './candidates/seedsById';
import type { MatchLambda, SelectLambda } from './compile/compile';
import {
  hasAttr, isChecked, isDefault, isDefined, isDisabled, isEnabled, isFocused, isIndeterminate,
  isInRange, isInvalid, isMuted, isNthElement, isNthOfType, isOptional, isOutOfRange, isPaused,
  isPlaceholderShown, isPlaying, isReadWrite, isRequired, isSeeking, checkTag, isValid, matchAttribute,
  matchDir, matchHasFrom, matchLang, nthElement, nthOfType, checkId, checkClass,
  isScope, isRoot, isEmpty, isFirstChild, isLastChild, isOnlyChild, isFirstOfType,
  isLastOfType, isOnlyOfType, matchesNthIndex, isAnyLink, isTarget, isHovered, isActive, isFocusWithin,
  matchPrevAny, matchPrev, matchParent, matchAncestor,
  type SelectorCombinator, type HashCache,
} from './compile/runtime';
import type { DebugMatch, DebugSelect } from './debug';
import type { CustomPseudoPredicate, SelectletConfig } from './selectlet';
import { escapeRegExp } from './utils/css';
import { isDocument, isElement, isFormStateElement, isHtmlDoc, isQuirksMode } from './utils/dom';

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

  // debugging
  isDebug = false;
  debugSelect: DebugSelect | undefined;
  debugMatch: DebugMatch | undefined;
  debugStack: (DebugSelect | DebugMatch)[] = [];
  debugCompile: string | undefined;

  config: SelectletConfig;
  pseudos: Record<string, CustomPseudoPredicate> = {};

  // caps
  seedsById: SeedIdFn;
  seedsByClass: SeedClassFn;
  readonly docDesignMode: (doc: Document) => string | undefined;

  // state for dynamic pseudo-classes
  hoverTarget: Element | null = null;
  activeTarget: Element | null = null;
  focusTarget: Element | null = null;

  // cache
  matchLambdas = new Map<string, MatchLambda>();
  selectLambdasNoCb = new Map<string, SelectLambda>();
  selectLambdasWithCb = new Map<string, SelectLambda>();
  strictMatchResolvers = new Map<string, MatchResolver>();
  forgivingMatchResolvers = new Map<string, MatchResolver>();
  selectResolvers = new Map<string, SelectResolver>();
  cachedRegex_S = new Map<string, RegExp>();
  cachedRegex_I = new Map<string, RegExp>();
  classRegex_S = new Map<string, RegExp>();
  classRegex_I = new Map<string, RegExp>();
  tokenRegex_S = new Map<string, RegExp>();
  tokenRegex_I = new Map<string, RegExp>();

  // perf testing hooks
  probe = {
    select: 0,
    selBuild: 0,
    match: 0,
    matBuild: 0,
    reset: () => {
      this.probe.select = 0;
      this.probe.selBuild = 0;
      this.probe.match = 0;
      this.probe.matBuild = 0;
    },
  };

  constructor(doc: Document, config: SelectletConfig, caps?: Partial<SelectletCaps>) {
    const root = doc.documentElement as Element | null;

    this.config = config;

    this.seedsById = buildSeedsById(caps, this);
    this.seedsByClass = buildSeedsByClass(caps, this);
    this.docDesignMode = caps?.doc?.designMode ?? ((doc) => doc.designMode);

    this.doc = doc;
    this.from = doc;
    this.root = root;
    this.scopeEl = null;

    this.isHtml = isHtmlDoc(doc);
    this.isQuirksMode = isQuirksMode(doc);
    this.namespace = root?.namespaceURI ?? null;
    this.hasDocumentAll = 'all' in doc;
    this.hasTreeWalker = 'createTreeWalker' in doc;
  }

  clearCache(): void {
    this.matchLambdas.clear();
    this.selectLambdasNoCb.clear();
    this.selectLambdasWithCb.clear();
    this.strictMatchResolvers.clear();
    this.forgivingMatchResolvers.clear();
    this.selectResolvers.clear();
    this.cachedRegex_S.clear();
    this.cachedRegex_I.clear();
    this.classRegex_S.clear();
    this.classRegex_I.clear();
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
    return regex;
  }

  getClassRegex(cls: string): RegExp {
    const cache = this.isQuirksMode ? this.classRegex_I : this.classRegex_S;

    let regex = cache.get(cls);
    if (regex !== undefined) return regex;

    regex = new RegExp(`(^|[\\t\\n\\f\\r ])${escapeRegExp(cls)}([\\t\\n\\f\\r ]|$)`, this.isQuirksMode ? 'i' : '');
    cache.set(cls, regex);
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
    return regex;
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

  first(sel: string, context?: QueryContext, isApiEntry?: boolean) {
    return queryFirst(sel, context ?? this.doc, this, isApiEntry);
  }

  match(sel: string, context: Element, h: HashCache | null = null) {
    return queryMatch(sel, context, this, h);
  }

  select(sel: string, context?: QueryContext, cb?: QueryCallback | null, isApiEntry?: boolean) {
    return querySelect(sel, context ?? this.doc, cb ?? null, this, isApiEntry);
  }

  ancestor(sel: string, context: Element) {
    return queryClosest(sel, context, this);
  }

  // -------- Runtime matchers used by emitted selector functions --------

  // full selector match
  matchStrict(selectors: string, element: Element, h: HashCache | null = null) {
    return matchStrict(selectors, element, this, h);
  }

  // combinators
  matchPrevAny = matchPrevAny;
  matchPrev = matchPrev;
  matchParent = matchParent;
  matchAncestor = matchAncestor;

  // basic element tests
  checkId = checkId;
  checkClass(e: Element, cls: string) { return checkClass(e, cls, this); }
  checkTag = checkTag;
  isScope(e: Element) { return isScope(e, this); }
  isRoot(e: Element) { return isRoot(e, this); }
  isEmpty = isEmpty;

  // attributes
  hasAttr(e: Element, anyNs: boolean, local: string, htmlLocal: string, hasColon: boolean): boolean {
    return hasAttr(e, anyNs, local, htmlLocal, hasColon, this);
  }
  matchAttribute(e: Element, anyNs: boolean, name: string, htmlName: string, hasColonName: boolean,
    pattern: string, expected: string, htmlExpected: string, sensitivity: number) {
    return matchAttribute(e, anyNs, name, htmlName, hasColonName, pattern, expected, htmlExpected, sensitivity, this);
  }

  // structural position
  isFirstChild = isFirstChild;
  isLastChild = isLastChild;
  isOnlyChild = isOnlyChild;
  isFirstOfType = isFirstOfType;
  isLastOfType = isLastOfType;
  isOnlyOfType = isOnlyOfType;
  matchesNthIndex = matchesNthIndex;
  nthOfType = nthOfType;
  nthElement = nthElement;
  isNthElement = isNthElement;
  isNthOfType = isNthOfType;

  // relational / language / link-state
  matchHas(steps: [SelectorCombinator, string][], anchor: Element, h: HashCache) {
    return matchHasFrom(steps, 0, anchor, this, h);
  }
  matchDir = matchDir;
  matchLang = matchLang;
  isAnyLink = isAnyLink;
  isTarget(e: Element) { return isTarget(e, this); }
  defined(element: Element) { return isDefined(element, this); }

  // dynamic state
  isHovered(e: Element) { return isHovered(e, this); }
  isActive(e: Element) { return isActive(e, this); }
  isFocusWithin(e: Element) { return isFocusWithin(e, this); }
  isFocused(node: Element) { return isFocused(node, this); }

  // form / validity / media state
  isDisabled = isDisabled;
  isEnabled = isEnabled;
  isReadWrite = (e: Element) => isReadWrite(e, this);
  isFormStateElement = isFormStateElement;
  isPlaceholderShown = isPlaceholderShown;
  isDefault = isDefault;
  isChecked = isChecked;
  isIndeterminate = isIndeterminate;
  isRequired = isRequired;
  isOptional = isOptional;
  isValid = isValid;
  isInvalid = isInvalid;
  isInRange = isInRange;
  isOutOfRange = isOutOfRange;
  isPlaying = isPlaying;
  isPaused = isPaused;
  isSeeking = isSeeking;
  isMuted = isMuted;
}
