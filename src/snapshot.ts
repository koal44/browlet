import { byClass, byId, byTag, byTagNs } from "./api/lookup";
import { queryClosest, queryFirst, matchForgiving, queryMatch, matchStrict, querySelect } from "./api/query";
import {
  hasAttr, isChecked, isDefault, isDefined, isDisabled, isEnabled, isFocused, isIndeterminate,
  isInRange, isInvalid, isMuted, isNthElement, isNthOfType, isOptional, isOutOfRange, isPaused,
  isPlaceholderShown, isPlaying, isReadWrite, isRequired, isSeeking, checkTag, isValid, matchAttribute,
  matchDir, matchHasFrom, matchLang, nthElement, nthOfType, checkId, checkClass,
  isScope, isRoot, isEmpty, isFirstChild, isLastChild, isOnlyChild, isFirstOfType,
  isLastOfType, isOnlyOfType, matchesNthIndex,
  isAnyLink,
  isTarget,
  isHovered,
  isActive,
  isFocusWithin
} from "./compile/runtime";
import { buildRex } from "./rex";
import { escapeRegExp } from "./utils/css";
import { getNamespace, isDocument, isElement, isFormStateElement, isHtmlDoc, isQuirksMode } from "./utils/dom";

export const DEFAULT_CONFIG: NwsConfig = {
  // When enabled, methods that return multiple elements will return a
  // NodeList-like object instead of an array.
  NODE_LIST: false,

  // Allows duplicate-ID candidate lookup to temporarily remove and restore id
  // attributes in contexts where no fast id collection is available.
  // Faster for DocumentFragment/template contexts, but observable by mutation
  // observers and other DOM-inspection code. Disabled by default.
  MUTATE_IDS: false,
};

export const DEFAULT_EXTENSIONS: NwsExtensions = {
  operators: ['~=', '*=', '^=', '$=', '|=', '='],
  combinators: ['>', '+', '~', ' ', '\t'],
};

export function initSnapshot(doc: Document) {
  const snap = {
    doc: doc,
    from: doc as QueryContext,
    root: doc.documentElement as Element,
    scopeEl: null as Element | null,
    isHtml: isHtmlDoc(doc),
    isQuirksMode: isQuirksMode(doc),
    namespace: getNamespace(doc) as string | null,
    hasDocumentAll: 'all' in doc,
    hasTreeWalker: 'createTreeWalker' in doc,
    re: {} as Rex,

    isDebug: false,
    debugSelect: undefined as DebugSelect | undefined,
    debugMatch: undefined as DebugMatch | undefined,
    debugStack: [] as (DebugSelect | DebugMatch)[],

    // special handling configuration flags
    config: { ...DEFAULT_CONFIG } as NwsConfig,
    ext: {
      operators: [...DEFAULT_EXTENSIONS.operators],
      combinators: [...DEFAULT_EXTENSIONS.combinators],
    } as NwsExtensions,
    selectors: {} as Record<string, SelectorExtension>,
    combinators: {} as Record<string, CombinatorCompiler>,
    operators: {
      '=':  { p1: '^',       p2: '$',       p3: true },
      '^=': { p1: '^',       p2: '',        p3: true },
      '$=': { p1: '',        p2: '$',       p3: true },
      '*=': { p1: '',        p2: '',        p3: true },
      '|=': { p1: '^',       p2: '(-|$)',   p3: true },
      '~=': { p1: '(^|\\s)', p2: '(\\s|$)', p3: true },
    } as Record<string, AttrMatcherParts>,

    hoverTarget: null as Element | null,
    activeTarget: null as Element | null,
    focusTarget: null as Element | null,

    // cached
    matchLambdas: new Map<string, MatchLambda>(),
    selectLambdas: new Map<string, SelectLambda>(),
    strictMatchResolvers: new Map<string, MatchResolver>(),
    forgivingMatchResolvers: new Map<string, MatchResolver>(),
    selectResolvers: new Map<string, SelectResolver>(),
    cachedRegex_S: new Map<string, RegExp>(),
    cachedRegex_I: new Map<string, RegExp>(),
    classRegex_S: new Map<string, RegExp>(),
    classRegex_I: new Map<string, RegExp>(),

    clearCache(): void {
      snap.matchLambdas.clear();
      snap.selectLambdas.clear();
      snap.strictMatchResolvers.clear();
      snap.forgivingMatchResolvers.clear();
      snap.selectResolvers.clear();
      snap.cachedRegex_S.clear();
      snap.cachedRegex_I.clear();
      snap.classRegex_S.clear();
      snap.classRegex_I.clear();
    },

    byId: (id: string, context?: QueryContext) => byId(id, context ?? snap.doc, snap),
    byTag: (tag: string, context?: QueryContext) => byTag(tag, context ?? snap.doc, snap),
    byTagNs: (ns: string | null, local: string, context?: QueryContext) => byTagNs(ns, local, context ?? snap.doc, snap),
    byClass: (cls: string, context?: QueryContext) => byClass(cls, context ?? snap.doc, snap),
    first: (sel: string, context?: QueryContext, isApiEntry?: boolean) => {
      return queryFirst(sel, context ?? snap.doc, snap, isApiEntry);
    },
    match: (sel: string, context: Element, h: HashCache | null = null) => {
      return queryMatch(sel, context, snap, h);
    },
    select: (sel: string, context?: QueryContext, cb?: QueryCallback | null, isApiEntry?: boolean) => {
      return querySelect(sel, context ?? snap.doc, cb ?? null, snap, isApiEntry);
    },
    ancestor: (sel: string, context: Element) => {
      return queryClosest(sel, context, snap);
    },

    matchStrict: (selectors: string, element: Element, h: HashCache | null = null) =>
      matchStrict(selectors, element, snap, h),
    matchForgiving: (selectors: string, element: Element, h: HashCache | null = null) =>
      matchForgiving(selectors, element, snap, h),

    checkId: checkId,
    checkClass: (e: Element, cls: string) => checkClass(e, cls, snap),
    checkTag: checkTag,
    isScope: (e: Element) => isScope(e, snap),
    isRoot: (e: Element) => isRoot(e, snap),
    isEmpty: isEmpty,
    isFirstChild: isFirstChild,
    isLastChild: isLastChild,
    isOnlyChild: isOnlyChild,
    isFirstOfType: isFirstOfType,
    isLastOfType: isLastOfType,
    isOnlyOfType: isOnlyOfType,
    matchesNthIndex: matchesNthIndex,
    nthOfType: nthOfType,
    nthElement: nthElement,
    isNthElement: isNthElement,
    isNthOfType: isNthOfType,
    matchHas: (steps: [SelectorCombinator, string][], anchor: Element, h: HashCache) => matchHasFrom(steps, 0, anchor, snap, h),
    matchDir: matchDir,
    matchLang: matchLang,
    isAnyLink: isAnyLink,
    isTarget: (e: Element) => isTarget(e, snap),
    defined: (element: Element) => isDefined(element, snap),
    isHovered: (e: Element) => isHovered(e, snap),
    isActive: (e: Element) => isActive(e, snap),
    isFocusWithin: (e: Element) => isFocusWithin(e, snap),
    isDisabled: isDisabled,
    isEnabled: isEnabled,
    isReadWrite: isReadWrite,
    isFormStateElement: isFormStateElement,
    isPlaceholderShown: isPlaceholderShown,
    isDefault: isDefault,
    isChecked: isChecked,
    isIndeterminate: isIndeterminate,
    isRequired: isRequired,
    isOptional: isOptional,
    isValid: isValid,
    isInvalid: isInvalid,
    isInRange: isInRange,
    isOutOfRange: isOutOfRange,
    isPlaying: isPlaying,
    isPaused: isPaused,
    isSeeking: isSeeking,
    isMuted: isMuted,
    hasAttr: (e: Element, anyNs: boolean, local: string, htmlLocal: string, hasColon: boolean): boolean =>
      hasAttr(e, anyNs, local, htmlLocal, hasColon, snap),
    matchAttribute: (e: Element, anyNs: boolean, name: string, htmlName: string, hasColonName: boolean, pattern: string, expected: string, htmlExpected: string, sensitivity: number) =>
      matchAttribute(e, anyNs, name, htmlName, hasColonName, pattern, expected, htmlExpected, sensitivity, snap),
    isFocused: (node: Element) =>
      isFocused(node, snap),

    getCachedRegex: (source: string, ignoreCase: boolean): RegExp => {
      const cache = ignoreCase ? snap.cachedRegex_I : snap.cachedRegex_S;

      let regex = cache.get(source);
      if (regex !== undefined) return regex;

      regex = new RegExp(source, ignoreCase ? "i" : "");
      cache.set(source, regex);
      return regex;
    },

    getClassRegex: (cls: string): RegExp => {
      const cache = snap.isQuirksMode ? snap.classRegex_I : snap.classRegex_S;

      let regex = cache.get(cls);
      if (regex !== undefined) return regex;

      regex = new RegExp(`(^|[\\t\\n\\f\\r ])${escapeRegExp(cls)}([\\t\\n\\f\\r ]|$)`, snap.isQuirksMode ? 'i' : '');
      cache.set(cls, regex);
      return regex;
    },

    update: (ctx: QueryContext, updateScope = false) => {
      const doc = ctx.ownerDocument ?? ctx;
      if (snap.doc !== doc) {
        snap.doc = doc;
        snap.root = doc.documentElement;
        snap.isHtml = isHtmlDoc(doc);
        snap.isQuirksMode = isQuirksMode(doc);
        snap.namespace = getNamespace(doc);
        snap.hasDocumentAll = 'all' in doc;
        snap.hasTreeWalker = 'createTreeWalker' in doc;
      }
      snap.from = ctx; // Debug breadcrumb only
      if (updateScope) {
        snap.scopeEl = isDocument(ctx) ? ctx.documentElement : isElement(ctx) ? ctx : null;
      }
    },

    probe: {
      select: 0,
      selBuild: 0,
      match: 0,
      matBuild: 0,
      reset: () => {
        snap.probe.select = 0;
        snap.probe.selBuild = 0;
        snap.probe.match = 0;
        snap.probe.matBuild = 0;
      }
    }
  };

  snap.re = buildRex(snap.ext);

  return snap;
}

export type Snapshot = ReturnType<typeof initSnapshot>;
