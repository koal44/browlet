import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeContext, type QueryContextDescription } from '../utils/debug';
import { isElement } from '../utils/dom';
import { buildSubjectSelect } from './select-subject';
import { buildWitnessSelect, type DebugWitnessProgram } from './select-witness';

export function querySelect(sel: string, ctx: QueryContext, snap: Snapshot): Element[] {
  snap.probe.select++;

  const isDebug = snap.isDebug;
  if (isDebug) initDebug(snap, sel, ctx);

  let resolver = snap.selectResolvers.get(sel);
  if (!resolver) {
    const parsed = parseSelectorList(sel, { pseudos: snap.pseudos });
    resolver = buildSelectResolver(parsed, snap);
    snap.selectResolvers.set(sel, resolver);
    snap.cacheSize++;
  }

  const select = resolveSelectStrategy(resolver, ctx, snap);

  snap.update(ctx, resolver.usesScope);

  let rc: RuntimeCache | null = null;
  if (resolver.usesCache) {
    snap.syncRuntimeCache(ctx);
    rc = snap.runtimeCache;
  }

  return select(ctx, rc, snap);
}

export type SelectResolver = {
  list: SelectorList;
  usesScope: boolean;
  usesCache: boolean;
  subject?: SelectRunFn;
  witness?: SelectRunFn;
};

export type SelectRunFn = (
  ctx: QueryContext,
  rc: RuntimeCache | null,
  snap: Snapshot,
) => Element[];

function buildSelectResolver(list: SelectorList, snap: Snapshot): SelectResolver {
  snap.checkCacheWatermark();
  snap.probe.selBuild++;

  return {
    list,
    usesScope: list.usesScope,
    usesCache: list.usesCache,
  };
}

function resolveSelectStrategy(
  resolver: SelectResolver,
  ctx: QueryContext,
  snap: Snapshot,
): SelectRunFn {
  // Element contexts force subject selection. Although element.querySelectorAll()
  // feels like a subtree query, the context only constrains returned subjects;
  // selector proof may still depend on ancestors/siblings outside the subtree.
  // Witness selection narrows the proof universe while walking left-to-right,
  // so it is not safe for element contexts.
  if (isElement(ctx)) {
    let subject = resolver.subject;
    if (!subject) {
      subject = buildSubjectSelect(resolver.list, snap);
      resolver.subject = subject;
    }
    return subject;
  } else { // Document, DocumentFragment
    // Document and fragment contexts prefer witness selection: author-written
    // selectors usually encode a left-to-right narrowing path. Subject grouping
    // can still beat witness for some selector lists, especially because merging
    // arms back into document order can be expensive.
    let witness = resolver.witness;
    if (!witness) {
      witness = buildWitnessSelect(resolver.list, snap);
      resolver.witness = witness;
    }
    return witness;
  }
}

export type DebugSelect = {
  kind: 'select';
  selectors: string;
  context?: QueryContextDescription;
  build: DebugSelectBuild[];
  run: DebugSelectRun[];
  error?: string;
};

export type DebugSelectBuild = {
  engine: 'subject' | 'witness';
  usesScope: boolean;
  usesCache: boolean;

  // subject-only
  lookupStrategy?: string;
  lookupQuery?: string;
  filterCost?: number;
  srcText?: string;

  // witness-only
  armIndex?: number;
};

export type DebugSelectRun = {
  engine: 'subject' | 'witness';

  // subject-only
  lookupStrategy?: string;
  lookupQuery?: string;
  candidates?: string[];
  srcText?: string;

  // witness-only
  armIndex?: number;
  program?: DebugWitnessProgram;

  results: string[];
};

function initDebug(snap: Snapshot, sel: string, ctx: QueryContext): void {
  snap.debugStack.length = 0;

  const dbgSelect: DebugSelect = {
    kind: 'select',
    selectors: sel,
    context: describeContext(ctx),
    build: [],
    run: [],
  };

  snap.debugSelect = dbgSelect;
  snap.debugStack.push(dbgSelect);
}
