import { parseSelectorList, type SelectorList } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import { describeContext, type QueryContextDescription } from '../utils/util';
import { isElement } from '../utils/dom';
import { buildSubjectSelect } from './select-subject';
import { buildWitnessSelect } from './select-witness';

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
  subjectOnly: boolean;
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
    subjectOnly: isSubjectOnlySelectorList(list),
  };
}

function resolveSelectStrategy(
  resolver: SelectResolver,
  ctx: QueryContext,
  snap: Snapshot,
): SelectRunFn {
  // Element contexts constrain returned subjects, but do not bound selector proof:
  // ancestors/siblings outside the element can still prove the selector.
  //
  // Root-like contexts can use witness selection because the query context is
  // also the proof universe for the current non-shadow selector model.
  if (isElement(ctx)) {
    let subject = resolver.subject;
    if (!subject) {
      subject = buildSubjectSelect(resolver.list, snap);
      resolver.subject = subject;

      if (resolver.subjectOnly) {
        resolver.witness = subject;
      }
    }

    return subject;
  }

  let witness = resolver.witness;
  if (!witness) {
    if (resolver.subjectOnly) {
      witness = resolver.subject;
      if (!witness) {
        witness = buildSubjectSelect(resolver.list, snap);
        resolver.subject = witness;
      }
    } else {
      witness = buildWitnessSelect(resolver.list, snap);
    }

    resolver.witness = witness;
  }

  return witness;
}

function isSubjectOnlySelectorList(list: SelectorList): boolean {
  for (let i = 0; i < list.arms.length; i++) {
    if (list.arms[i].parts.length !== 1) return false;
  }

  return true;
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

  // witness-only
  armIndex?: number;

  selectSrcText: string;
};

export type DebugSelectRun = {
  engine: 'subject' | 'witness';

  // subject-only
  lookupStrategy?: string;
  lookupQuery?: string;
  candidates?: string[];

  // witness-only
  armIndex?: number;

  selectSrcText: string;
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
