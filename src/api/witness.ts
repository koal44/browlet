/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-implied-eval */
import type { ComplexPart, ComplexSelector, CompoundSelector } from '../parser/parser';
import type { RuntimeCache } from '../compile/runtimeCache';
import type { QueryContextDescription } from '../utils/debug';
import { describeCombinator, describeContext, describeFilter, describeLookup } from '../utils/debug';
import { seedsByTag } from '../seeds/seedsByTag';
import { cssIdentUnescape } from '../utils/css';
import { buildCompoundTest, createBuildContext } from '../planner/filter';

export type WitnessProgram = {
  parts: ComplexPart[];
  start: BridgeMove;
  steps: WitnessStep[];
};

type WitnessStep = {
  advance: AdvanceMove | null | undefined;
  bridge: BridgeMove | null | undefined;
  finalBridge: BridgeMove | null | undefined;
  canRoot: boolean;
  count?: number;
  lookupRoot?: QueryContext;
};

export type WitnessState = {
  root: QueryContext;
  witnesses: Element[] | null;
};

type BridgeMove = {
  to: number;
  lookup: LookupFn;
  filter: BridgeFilter;
  debug?: string;
  count?: number;
};

type AdvanceMove = {
  to: number;
  run: AdvanceFn;
  first?: AdvanceFirstFn;
  combinator: AdvanceCombinator;
  filter: CompoundFilter;
  debug?: string;
};

type AdvanceCombinator = '>' | '+' | '~';

type CompoundFilter = (candidate: Element, rc: RuntimeCache | null) => boolean;
type BridgeFilter = (candidate: Element, witnesses: Element[] | null, rc: RuntimeCache | null) => boolean;
type LookupFn = (root: QueryContext) => Element[];
type AdvanceFn = (witnesses: Element[], rc: RuntimeCache | null) => Element[];

export function buildWitnessProgram(complex: ComplexSelector, snap: Snapshot): WitnessProgram {
  const { parts } = complex;

  if (parts.length === 0) {
    throw new Error('Cannot build witness program for empty complex selector');
  }

  const start = buildBridgeMove(parts, -1, chooseBridgeTarget(parts, -1), snap);
  const steps: WitnessStep[] = [];

  for (let i = 0; i < parts.length; i++) {
    steps[i] = {
      advance: undefined,
      bridge: undefined,
      finalBridge: undefined,
      canRoot: canRootAt(parts, i),
    };
  }

  return { parts, start, steps };
}

export function getAdvanceMove(program: WitnessProgram, index: number, snap: Snapshot): AdvanceMove | null {
  const step = program.steps[index];

  if (step.advance !== undefined) return step.advance;

  const advance = buildAdvanceMove(program.parts, index, snap);
  step.advance = advance;
  return advance;
}

export function getBridgeMove(program: WitnessProgram, index: number, snap: Snapshot): BridgeMove | null {
  const step = program.steps[index];

  if (step.bridge !== undefined) return step.bridge;

  const next = index + 1;
  if (next >= program.parts.length) {
    step.bridge = null;
    return null;
  }

  const bridge = buildBridgeMove(
    program.parts,
    index,
    chooseBridgeTarget(program.parts, index),
    snap,
  );

  step.bridge = bridge;
  return bridge;
}

export function getFinalBridgeMove(program: WitnessProgram, index: number, snap: Snapshot): BridgeMove {
  const step = program.steps[index];

  if (step.finalBridge !== undefined) {
    if (step.finalBridge === null) {
      throw new Error(`Invalid final witness bridge from terminal step: ${index}`);
    }

    return step.finalBridge;
  }

  const last = program.parts.length - 1;

  if (index >= last) {
    step.finalBridge = null;
    throw new Error(`Invalid final witness bridge from terminal step: ${index}`);
  }

  const bridge = buildBridgeMove(program.parts, index, last, snap);
  step.finalBridge = bridge;
  return bridge;
}

export function canAdvance(state: WitnessState): boolean {
  // Multi-witness advance is not order-safe unless the witness wave is known
  // to be an ancestor-antichain. Keep singleton-only until that proof exists.
  return state.witnesses !== null && state.witnesses.length === 1;
}

function canRootAt(parts: ComplexPart[], index: number): boolean {
  const next = index + 1;
  if (next >= parts.length) return true;

  const combinator = parts[next].combinator;

  // A singleton witness at part `index` may become lookup root only if the next
  // edge stays inside that witness's subtree. Sibling edges leave the subtree.
  return combinator !== '+' && combinator !== '~';
}

export function runAdvanceMove(state: WitnessState, move: AdvanceMove, canRoot: boolean, rc: RuntimeCache | null): void {
  const witnesses = state.witnesses;
  if (!witnesses) return;

  const next = move.run(witnesses, rc);
  updateWitnessState(state, next, canRoot);
}

export function runFirstAdvanceMove(state: WitnessState, move: AdvanceMove, rc: RuntimeCache | null): Element | null {
  const witnesses = state.witnesses;
  if (!witnesses) return null;

  let first = move.first;
  if (!first) {
    first = buildAdvanceFirstFn(move.combinator, move.filter);
    move.first = first;
  }

  return first(witnesses, rc);
}

export function runBridgeMove(state: WitnessState, move: BridgeMove, canRoot: boolean, rc: RuntimeCache | null): void {
  const candidates = move.lookup(state.root);
  const next = applyBridgeFilter(candidates, move.filter, state.witnesses, rc);
  updateWitnessState(state, next, canRoot);
}

export function runFirstBridgeMove(state: WitnessState, move: BridgeMove, rc: RuntimeCache | null): Element | null {
  const candidates = move.lookup(state.root);

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];

    if (move.filter(e, state.witnesses, rc)) {
      return e;
    }
  }

  return null;
}

function updateWitnessState(state: WitnessState, witnesses: Element[], canRoot: boolean): void {
  state.witnesses = witnesses;

  if (canRoot && witnesses.length === 1) {
    state.root = witnesses[0];
  }
}

function applyBridgeFilter(candidates: Element[], filter: BridgeFilter, witnesses: Element[] | null, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < candidates.length; i++) {
    const e = candidates[i];
    if (filter(e, witnesses, rc)) out[++j] = e;
  }

  return out;
}

function chooseBridgeTarget(parts: ComplexPart[], from: number): number {
  const start = from + 1;
  const last = parts.length - 1;

  for (let i = start; i <= last; i++) {
    if (parts[i].compound.id) return i;
  }

  for (let i = start; i <= last; i++) {
    if (parts[i].compound.classes?.length) return i;
  }

  return last;
}

function buildBridgeMove(parts: ComplexPart[], from: number, to: number, snap: Snapshot): BridgeMove {
  const compound = parts[to].compound;
  const lookup = buildLookup(compound, snap);

  markLookupSeed(compound);
  try {
    const move: BridgeMove = {
      to, lookup, filter: buildBridgeFilter(parts, from, to, snap),
    };
    if (snap.isDebug) {
      move.debug = `bridge ${describeMove(from, to)} · lookup ${describeLookup(compound)}`;
    }
    return move;
  } finally {
    resetCompoundSeeds(compound);
  }
}

function markLookupSeed(compound: CompoundSelector): void {
  if (compound.id) {
    compound.id.seed = true;
  } else if (compound.classes?.length) {
    for (let i = 0; i < compound.classes.length; i++) {
      compound.classes[i].seed = true;
    }
  } else if (compound.tag) {
    const { prefixRaw } = compound.tag;

    // seedsByTag is a localName superset. Explicit empty namespace selectors
    // like |tag and |* still need the residual namespace/type test.
    if (prefixRaw !== '') {
      compound.tag.seed = true;
    }
  }
}

function resetCompoundSeeds(compound: CompoundSelector): void {
  if (compound.id) compound.id.seed = false;
  if (compound.tag) compound.tag.seed = false;

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      compound.classes[i].seed = false;
    }
  }
}

function buildAdvanceMove(parts: ComplexPart[], from: number, snap: Snapshot): AdvanceMove | null {
  const to = from + 1;
  if (to >= parts.length) return null;

  const { combinator, compound } = parts[to];
  if (combinator === null) {
    throw new Error(`Missing combinator at part ${to} in witness advance move`);
  }
  if (combinator === ' ') return null;

  const filter = compileCompoundFilter(compound, snap);
  const run = buildAdvanceFn(combinator, filter);

  const move: AdvanceMove = { to, run, combinator, filter };
  if (snap.isDebug) {
    move.debug = `advance ${describeMove(from, to)} · ${describeCombinator(combinator)} · test ${describeFilter(compound)}`;
  }
  return move;
}

function buildLookup(compound: CompoundSelector, snap: Snapshot): LookupFn {
  if (compound.id) {
    const id = cssIdentUnescape(compound.id.raw);
    return (root) => snap.seedsById(id, root);
  }

  if (compound.classes?.length) {
    const classes = compound.classes.map((c) => cssIdentUnescape(c.raw));

    if (classes.some((c) => /[\t\n\f\r ]/.test(c))) {
      return () => [];
    }

    return (root) => snap.seedsByClass(classes, root);
  }

  if (compound.tag) {
    const { localRaw } = compound.tag;
    const query = localRaw === '*' ? '*' : cssIdentUnescape(localRaw);
    return (root) => seedsByTag(query, root, snap);
  }

  return (root) => seedsByTag('*', root, snap);
}

function compileCompoundFilter(compound: CompoundSelector, snap: Snapshot): CompoundFilter {
  const ctx = createBuildContext();
  const source = buildCompoundTest(compound, ctx);

  const f =
    `"use strict";` +
    ctx.declarations.join('') +
    `return function CompoundFilter(e,rc){` +
      `return (${source});` +
    `}`;

  return Function('s', f)(snap) as CompoundFilter;
}

function buildAdvanceFn(combinator: AdvanceCombinator, filter: CompoundFilter): AdvanceFn {
  switch (combinator) {
    case '>': return (witnesses, rc) => advanceChildren(witnesses, filter, rc);
    case '+': return (witnesses, rc) => advanceNextSibling(witnesses, filter, rc);
    case '~': return (witnesses, rc) => advanceFollowingSiblings(witnesses, filter, rc);
  }
}

type AdvanceFirstFn = (witnesses: Element[], rc: RuntimeCache | null) => Element | null;

function buildAdvanceFirstFn(combinator: AdvanceCombinator, filter: CompoundFilter): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (witnesses, rc) => firstChild(witnesses, filter, rc);
    case '+': return (witnesses, rc) => firstNextSibling(witnesses, filter, rc);
    case '~': return (witnesses, rc) => firstFollowingSibling(witnesses, filter, rc);
  }
}

function advanceNextSibling(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < witnesses.length; i++) {
    const candidate = witnesses[i].nextElementSibling;
    if (candidate && filter(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < witnesses.length; i++) {
    for (let candidate = witnesses[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (filter(candidate, rc) && !seen.has(candidate)) {
        seen.add(candidate);
        out[out.length] = candidate;
      }
    }
  }

  return out;
}

function advanceChildren(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < witnesses.length; i++) {
    for (let candidate = witnesses[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (filter(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

function firstNextSibling(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < witnesses.length; i++) {
    const candidate = witnesses[i].nextElementSibling;
    if (candidate && filter(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < witnesses.length; i++) {
    for (let candidate = witnesses[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (filter(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(witnesses: Element[], filter: CompoundFilter, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < witnesses.length; i++) {
    for (let candidate = witnesses[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (filter(candidate, rc)) return candidate;
    }
  }

  return null;
}

function buildBridgeFilter(parts: ComplexPart[], from: number, to: number, snap: Snapshot): BridgeFilter {
  if (to <= from) {
    throw new Error(`Invalid witness bridge: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  let relation: BridgeFilter = compileCompoundBridgeFilter(parts[start].compound, snap);

  if (from >= 0) {
    const left = relation;
    const connect = buildRelationToWitnesses(parts[start].combinator);

    relation = function BridgeRelation(candidate, witnesses, rc) {
      return left(candidate, witnesses, rc) && connect(candidate, witnesses, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const right = compileCompoundFilter(parts[i].compound, snap);
    const left = relation;
    const connect = buildRelationToPredicate(parts[i].combinator, left);

    relation = function BridgeRelation(candidate, witnesses, rc) {
      return right(candidate, rc) && connect(candidate, witnesses, rc);
    };
  }

  return relation;
}

function compileCompoundBridgeFilter(compound: CompoundSelector, snap: Snapshot): BridgeFilter {
  const filter = compileCompoundFilter(compound, snap);

  return function BridgeRelation(candidate, _witnesses, rc) {
    return filter(candidate, rc);
  };
}

function buildRelationToWitnesses(combinator: string | null): BridgeFilter {
  switch (combinator) {
    case ' ':
      return function relation(candidate, witnesses) {
        return matchAncestorInSet(candidate, witnesses);
      };

    case '>':
      return function relation(candidate, witnesses) {
        return matchParentInSet(candidate, witnesses);
      };

    case '+':
      return function relation(candidate, witnesses) {
        return matchPrevInSet(candidate, witnesses);
      };

    case '~':
      return function relation(candidate, witnesses) {
        return matchPrevAnyInSet(candidate, witnesses);
      };

    default:
      throw new Error(`Invalid witness bridge combinator: ${String(combinator)}`);
  }
}

function buildRelationToPredicate(combinator: string | null, pred: BridgeFilter): BridgeFilter {
  switch (combinator) {
    case ' ':
      return function relation(candidate, witnesses, rc) {
        return matchAncestorBy(candidate, pred, witnesses, rc);
      };

    case '>':
      return function relation(candidate, witnesses, rc) {
        return matchParentBy(candidate, pred, witnesses, rc);
      };

    case '+':
      return function relation(candidate, witnesses, rc) {
        return matchPrevBy(candidate, pred, witnesses, rc);
      };

    case '~':
      return function relation(candidate, witnesses, rc) {
        return matchPrevAnyBy(candidate, pred, witnesses, rc);
      };

    default:
      throw new Error(`Invalid witness bridge combinator: ${String(combinator)}`);
  }
}

function inElementSet(xs: Element[] | null, e: Element): boolean {
  if (!xs) return false;

  for (let i = 0; i < xs.length; i++) {
    if (xs[i] === e) return true;
  }

  return false;
}

function matchAncestorInSet(e: Element, xs: Element[] | null): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (inElementSet(xs, p)) return true;
  }

  return false;
}

function matchParentInSet(e: Element, xs: Element[] | null): boolean {
  const p = e.parentElement;
  return p !== null && inElementSet(xs, p);
}

function matchPrevInSet(e: Element, xs: Element[] | null): boolean {
  const p = e.previousElementSibling;
  return p !== null && inElementSet(xs, p);
}

function matchPrevAnyInSet(e: Element, xs: Element[] | null): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (inElementSet(xs, p)) return true;
  }

  return false;
}

function matchAncestorBy(e: Element, pred: BridgeFilter, witnesses: Element[] | null, rc: RuntimeCache | null): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (pred(p, witnesses, rc)) return true;
  }

  return false;
}

function matchParentBy(e: Element, pred: BridgeFilter, witnesses: Element[] | null, rc: RuntimeCache | null): boolean {
  const p = e.parentElement;
  return p !== null && pred(p, witnesses, rc);
}

function matchPrevBy(e: Element, pred: BridgeFilter, witnesses: Element[] | null, rc: RuntimeCache | null): boolean {
  const p = e.previousElementSibling;
  return p !== null && pred(p, witnesses, rc);
}

function matchPrevAnyBy(e: Element, pred: BridgeFilter, witnesses: Element[] | null, rc: RuntimeCache | null): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (pred(p, witnesses, rc)) return true;
  }

  return false;
}

export type DebugWitnessProgram = {
  start: DebugWitnessStart;
  steps: DebugWitnessStep[];
};

type DebugWitnessStart = {
  bridge: string;
  count?: number;
};

type DebugWitnessStep = {
  index: number;
  advance: string;
  bridge: string;
  finalBridge: string;
  canRoot: boolean;
  count?: number;
  lookupRoot?: QueryContextDescription;
};

export function describeWitnessProgram(program: WitnessProgram): DebugWitnessProgram {
  const steps: DebugWitnessStep[] = [];
  const last = program.steps.length - 1;

  for (let i = 0; i < last; i++) {
    const step = program.steps[i];

    const dbg: DebugWitnessStep = {
      index: i,
      canRoot: step.canRoot,
      advance: describeAdvanceMove(step.advance, i),
      bridge: describeBridgeMove(step.bridge, i),
      finalBridge: describeBridgeMove(step.finalBridge, i),
      lookupRoot: step.lookupRoot ? describeContext(step.lookupRoot, { preview: false }) : undefined,
    };

    if (step.count !== undefined) {
      dbg.count = step.count;
    }

    steps[steps.length] = dbg;
  }

  const start: DebugWitnessStart = {
    bridge: program.start.debug ?? `bridge entry ➝ ${program.start.to}`,
  };

  if (program.start.count !== undefined) {
    start.count = program.start.count;
  }

  return { start, steps };
}

function describeAdvanceMove(move: AdvanceMove | null | undefined, from: number): string {
  if (move === undefined) return 'unbuilt';
  if (move === null) return 'cannot';
  return move.debug ?? `advance ${from} ➝ ${move.to}`;
}

function describeBridgeMove(move: BridgeMove | null | undefined, from: number): string {
  if (move === undefined) return 'unbuilt';
  if (move === null) return 'cannot';
  return move.debug ?? `bridge ${from} ➝ ${move.to}`;
}

function describeMove(from: number, to: number): string {
  return `${describeIndex(from)} ➝ ${to}`;
}

function describeIndex(index: number): string {
  return index < 0 ? 'entry' : String(index);
}

export function resetWitnessDebug(program: WitnessProgram): void {
  program.start.count = undefined;

  for (let i = 0; i < program.steps.length; i++) {
    program.steps[i].count = undefined;
    program.steps[i].lookupRoot = undefined;
  }
}
