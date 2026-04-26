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
type NwsExtensions = {
  combinators: string;
  operators: string;
}

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
    match: RegExpMatchArray | null,
    source: string,
    mode: boolean | null,
    callback: QueryCallback | null
  ) => {
    match: RegExpMatchArray | null,
    modvar: string,
    source: string,
    status: boolean,
  };

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
  ext: NwsExtensions;
  selectors: Record<string, SelectorExtension>;
  combinators: Record<string, string>;
  operators: Record<string, AttrMatcherParts>

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

  hoverTarget: EventTarget | null;

  isDebug: boolean;
  debugCompile?: string;
  debugCollect?: DebugCollect;

  re: Rex;

  matchLambdas: Partial<Record<string, MatchLambda>>;
  selectLambdas: Partial<Record<string, SelectLambda>>;

  matchResolvers: Partial<Record<string, MatchResolver>>;
  selectResolvers: Partial<Record<string, SelectResolver>>;
};

type CssEscapeFn = (ident: string) => string;

type DomApi = {
  version: string;
  extensions: NwsExtensions;
  config: NwsConfig;
  snapshot: SnapshotState;

  byId: ByIdFn;
  byTag: ByTagFn;
  byClass: ByClassFn;

  first: FirstFn;
  match: MatchFn;
  select: SelectFn;
  closest: ClosestFn;

  configure: (option?: ConfigKey | Partial<Record<ConfigKey, boolean>> | undefined, clear?: boolean) => boolean | NwsConfig;

  install: (all?: boolean) => void;
  uninstall: () => void;

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

type Rex = {
  HasEscapes: RegExp;
  HexNumbers: RegExp;
  EscOrQuote: RegExp;
  RegExpChar: RegExp;
  TrimSpaces: RegExp;
  SplitGroup: RegExp;
  CommaGroup: RegExp;
  FixEscapes: RegExp;
  CombineWSP: RegExp;
  TabCharWSP: RegExp;
  PseudosWSP: RegExp;

  STD: {
    combinator: RegExp;
    apimethods: RegExp;
    namespaces: RegExp;
  };

  Patterns: {
    treestruct: RegExp;
    structural: RegExp;
    linguistic: RegExp;
    useraction: RegExp;
    inputstate: RegExp;
    inputvalue: RegExp;
    rsrc_state: RegExp;
    disp_state: RegExp;
    time_state: RegExp;
    locationpc: RegExp;
    logicalsel: RegExp;
    pseudo_nop: RegExp;
    pseudo_sng: RegExp;
    pseudo_dbl: RegExp;

    children: RegExp;
    adjacent: RegExp;
    relative: RegExp;
    ancestor: RegExp;

    universal: RegExp;
    namespace: RegExp;

    id: RegExp;
    tagName: RegExp;
    className: RegExp;
    attribute: RegExp;
  };

  RTL: RegExp;
  nthElem: RegExp;
  nthType: RegExp;

  optimizer: RegExp;
  validator: RegExp;
}

type QsaKey =
  'closest' | 'matches' | 'querySelector' | 'querySelectorAll' |
  'querySelectorDoc' | 'querySelectorAllDoc';
