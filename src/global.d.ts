type Glob = typeof globalThis

interface AmdDefine {
  (factory: unknown): void;
  (deps: string[], factory: unknown): void;
  amd?: unknown;
}

declare var define: AmdDefine | undefined;

declare var NW: {
  Dom?: DomApi;
  [key: string]: unknown;
} | undefined;

type NwsConfig = Record<ConfigKey, boolean>;
type ConfigKey = 'IDS_DUPES' | 'FORGIVING' | 'NODE_LIST' | 'LOGERRORS' | 'USR_EVENT' | 'VERBOSITY';

type QueryContext = Document | Element | DocumentFragment;
type QueryCallback = (element: Element) => unknown;

type OptimizerKey = '#' | '*' | '.';
type CompatKey = '#' | '*' | '|' | '.';
type CompatThunk = () => Element[];
type CompatFactory = (c: QueryContext, n: string, s: SnapshotState) => CompatThunk;
type CompatSeed = `${CompatKey}${string}`;

type MatchLambda = (
  element: Element,
  callback: QueryCallback | null,
  context: null,
  results: false
) => boolean;

type SelectLambda = (
  list: Element[],
  callback: QueryCallback | null,
  context: QueryContext,
  nodes: Element[]
) => Element[];

type MatchResolver = {
  factory: MatchLambda[];
};

type SelectResolver = {
  callback: QueryCallback | null;
  context: QueryContext;
  factory: SelectLambda[];
  htmlset: CompatThunk[];
  nodeset: CompatSeed[];
  results: Element[];
};

type IndexedNodeList = NodeListOf<Element> & { length: number; [index: number]: Element };
type ToNodeListFn = (nodeArray: Element[]) => IndexedNodeList;
type ElementList = Element[] | IndexedNodeList;

type AttrMatcherParts = { p1: string; p2: string; p3: string; };

type SelectorExtension = {
  Expression: RegExp;
  Callback: SelectorExtFn;
};

type SelectorExtFn = (
    match: string[],
    source: string,
    mode: boolean | null,
    callback: QueryCallback | null
  ) => {
    match: string[] | null,
    modvar: string,
    source: string,
    status: boolean,
  }

type RawByTagFn = (tag: string, context: QueryContext) => Element[];
type RawByClassFn = (cls: string, context: QueryContext) => Element[];
type RawByIdFn = (id: string, context: QueryContext) => Element[];
type RawSelectFn = (selectors: string, context: QueryContext, callback: QueryCallback | null, snap: SnapshotState) => Element[];
type RawFirstFn = (selectors: string, context: QueryContext, callback: QueryCallback | null, snap: SnapshotState) => Element | null;
type RawMatchFn = (selectors: string, element: Element, callback: QueryCallback | null, snap: SnapshotState) => boolean;
type RawAncestorFn = (selectors: string, element: Element, callback: QueryCallback | null, snap: SnapshotState) => Element | null;

type ByTagFn = (tag: string, context?: QueryContext) => ElementList;
type ByClassFn = (cls: string, context?: QueryContext) => ElementList;
type ByIdFn = (id: string, context?: QueryContext) => ElementList;
type SelectFn = (selectors: string, context?: QueryContext, callback?: QueryCallback | null) => ElementList;

type FirstFn = (selectors: string, context?: QueryContext, callback?: QueryCallback | null) => Element | null;
type MatchFn = (selectors: string, element: Element, callback?: QueryCallback | null) => boolean;
type AncestorFn = (selectors: string, element: Element, callback?: QueryCallback | null) => Element | null;
type ClosestFn = AncestorFn;
type NthFn = (element: Element, dir: number) => number;
type IsFocusableFn = (node: HTMLElement) => false | HTMLElement;
type IsContentEditableFn = (node: HTMLElement) => boolean;
type HasAttributeNSFn = (element: Element, name: string) => boolean;

type CompileFn = (selector: string, mode: boolean | null, cb: QueryCallback | null, snap: SnapshotState) => SelectLambda | MatchLambda;
type RegisterCombinatorFn = (combinator: string, resolver: string) => void;
type RegisterOperatorFn = (operator: string, resolver: AttrMatcherParts) => void;
type RegisterSelectorFn = (name: string, rexp: RegExp, func: SelectorExtFn) => void;

type SnapshotState = {
  doc: Document;
  from: QueryContext;
  root: Element;
  isHtml: boolean;
  isQuirksMode: boolean;
  namespace: string | null;
  config: NwsConfig;

  byTag: ByTagFn;

  first: FirstFn;
  match: MatchFn;
  select: SelectFn;
  ancestor: AncestorFn;

  nthOfType: NthFn;
  nthElement: NthFn;

  isFocusable: IsFocusableFn;
  isContentEditable: IsContentEditableFn;
  hasAttributeNS: HasAttributeNSFn;

  HOVER: EventTarget | null;

  isDebug: boolean;
  debugCompile?: string;
  debugCollect?: DebugCollect;
};

type CssEscapeFn = (ident: string) => string;

type DomApi = {
  matchLambdas: Record<string, MatchLambda>;
  selectLambdas: Record<string, SelectLambda>;

  matchResolvers: Record<string, MatchResolver>;
  selectResolvers: Record<string, SelectResolver>;

  CFG: { operators: string, combinators: string };

  S_BODY: string;
  M_BODY: string;
  N_BODY: string;

  S_TEST: string;
  M_TEST: string;
  N_TEST: string;

  byId: ByIdFn;
  byTag: ByTagFn;
  byClass: ByClassFn;

  first: FirstFn;
  match: MatchFn;
  select: SelectFn;
  closest: ClosestFn;

  compile: CompileFn;
  configure: (option?: ConfigKey | Partial<Record<ConfigKey, boolean>> | undefined, clear?: boolean) => boolean | NwsConfig;

  emit: (message: string, proto?: ErrorConstructor | undefined) => void;
  Config: NwsConfig;
  Snapshot: SnapshotState;

  Version: string;

  install: (all?: boolean) => void;
  uninstall: () => void;

  Operators: Record<string, AttrMatcherParts>;
  Selectors: Record<string, SelectorExtension>;

  registerCombinator: RegisterCombinatorFn;
  registerOperator: RegisterOperatorFn;
  registerSelector: RegisterSelectorFn;

  setDebug: (enabled: boolean) => void;
  clearDebug: () => void;
  printDebug: () => string;
};

type DebugCollect = {
  callback: QueryCallback | null;
  context: QueryContextDescription;
  steps: DebugCollectStep[];
};

type DebugCollectStep = {
  index: number;

  original: string;
  optimized: string;
  seenBefore: boolean;

  token: [string, '.' | '#' | '*', string];
  rawTokenValue: string;
  unescapedTokenValue: string;

  nodeset: CompatSeed;

  factorySource: string;
  factoryInput: string[];
  factoryResults: string[];
};

type QueryContextDescription = {
  kind: 'document' | 'fragment' | 'element' | 'unknown';
  summary: string;
  preview?: string;
}

type NodeLike = { nodeType: number; nodeName: string; };
