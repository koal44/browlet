/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-implied-eval */
import type { RuntimeCache } from '../compile/runtimeCache';
import type { Combinator, ComplexPart, ComplexSelector, CompoundSelector } from '../parser/parser';
import { buildCompoundTest, createBuildContext } from './filter';

export type Chain = ChainRelation[];

export type ChainRelation = {
  combinator: Combinator | null;
  left: ComplexPart;
  right: ComplexPart;
};

export function buildChain(complex: ComplexSelector): Chain {
  const { parts } = complex;

  if (parts.length === 0) {
    throw new Error('Cannot build chain for empty complex selector');
  }

  const chain: Chain = [];
  chain[0] = {
    combinator: null,
    left: parts[0],
    right: parts[0],
  };

  for (let i = 1; i < parts.length; i++) {
    const combinator = parts[i].combinator;
    if (combinator === null) {
      throw new Error(`Missing combinator at part ${i}`);
    }

    chain[i] = {
      combinator,
      left: parts[i - 1],
      right: parts[i],
    };
  }

  return chain;
}

type CompoundTestFn = (candidate: Element, rc: RuntimeCache | null) => boolean;

function compileStepProof(rel: ChainRelation, snap: Snapshot): ProofFn {
  const test = compileStepTest(rel, snap);

  return function proof(candidate, _frontier, rc) {
    return test(candidate, rc);
  };
}

function compileStepTest(rel: ChainRelation, snap: Snapshot): CompoundTestFn {
  return compileCompoundTest(rel.right.compound, snap);
}

function compileCompoundTest(compound: CompoundSelector, snap: Snapshot): CompoundTestFn {
  const ctx = createBuildContext();
  const source = buildCompoundTest(compound, ctx);

  const f =
    `"use strict";` +
    ctx.declarations.join('') +
    `return function compoundTest(e,rc){` +
      `return (${source});` +
    `}`;

  return Function('s', f)(snap) as CompoundTestFn;
}

// -------------- PROOF -----------------

export type ProofFn = (candidate: Element, frontier: Element[] | null, rc: RuntimeCache | null) => boolean;

export function buildProof(chain: Chain, from: number, to: number, snap: Snapshot): ProofFn {
  if (from < -1 || to < 0 || to >= chain.length || to <= from) {
    throw new Error(`Invalid proof range: ${from} ➝ ${to}`);
  }

  const start = from + 1;
  let proof: ProofFn = compileStepProof(chain[start], snap);

  if (from >= 0) {
    const prev = proof;
    const connect = buildConnectionToFrontier(chain[start]);

    proof = function proof(candidate, frontier, rc) {
      return prev(candidate, frontier, rc) && connect(candidate, frontier, rc);
    };
  }

  for (let i = start + 1; i <= to; i++) {
    const step = compileStepTest(chain[i], snap);
    const prev = proof;
    const connect = extendProof(chain[i], prev);

    proof = function proof(candidate, frontier, rc) {
      return step(candidate, rc) && connect(candidate, frontier, rc);
    };
  }

  return proof;
}

function buildConnectionToFrontier(rel: ChainRelation): ProofFn {
  switch (rel.combinator) {
    case ' ':
      return function proof(candidate, frontier) {
        return matchAncestorInFrontier(candidate, frontier);
      };

    case '>':
      return function proof(candidate, frontier) {
        return matchParentInFrontier(candidate, frontier);
      };

    case '+':
      return function proof(candidate, frontier) {
        return matchPrevInFrontier(candidate, frontier);
      };

    case '~':
      return function proof(candidate, frontier) {
        return matchPrevAnyInFrontier(candidate, frontier);
      };

    default:
      throw new Error(`Invalid frontier connection combinator: ${String(rel.combinator)}`);
  }
}


function inFrontier(e: Element, frontier: Element[] | null): boolean {
  if (!frontier) return false;

  for (let i = 0; i < frontier.length; i++) {
    if (frontier[i] === e) return true;
  }

  return false;
}

function matchAncestorInFrontier(e: Element, frontier: Element[] | null): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (inFrontier(p, frontier)) return true;
  }

  return false;
}

function matchParentInFrontier(e: Element, frontier: Element[] | null): boolean {
  const p = e.parentElement;
  return p !== null && inFrontier(p, frontier);
}

function matchPrevInFrontier(e: Element, frontier: Element[] | null): boolean {
  const p = e.previousElementSibling;
  return p !== null && inFrontier(p, frontier);
}

function matchPrevAnyInFrontier(e: Element, frontier: Element[] | null): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (inFrontier(p, frontier)) return true;
  }

  return false;
}

function extendProof(rel: ChainRelation, prev: ProofFn): ProofFn {
  switch (rel.combinator) {
    case ' ':
      return function proof(candidate, frontier, rc) {
        return matchAncestorBy(candidate, prev, frontier, rc);
      };

    case '>':
      return function proof(candidate, frontier, rc) {
        return matchParentBy(candidate, prev, frontier, rc);
      };

    case '+':
      return function proof(candidate, frontier, rc) {
        return matchPrevBy(candidate, prev, frontier, rc);
      };

    case '~':
      return function proof(candidate, frontier, rc) {
        return matchPrevAnyBy(candidate, prev, frontier, rc);
      };

    default:
      throw new Error(`Invalid proof extension combinator: ${String(rel.combinator)}`);
  }
}

function matchAncestorBy(e: Element, proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) {
    if (proof(p, frontier, rc)) return true;
  }

  return false;
}

function matchParentBy(e: Element, proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): boolean {
  const p = e.parentElement;
  return p !== null && proof(p, frontier, rc);
}

function matchPrevBy(e: Element, proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): boolean {
  const p = e.previousElementSibling;
  return p !== null && proof(p, frontier, rc);
}

function matchPrevAnyBy(e: Element, proof: ProofFn, frontier: Element[] | null, rc: RuntimeCache | null): boolean {
  for (let p = e.previousElementSibling; p; p = p.previousElementSibling) {
    if (proof(p, frontier, rc)) return true;
  }

  return false;
}

// -------------- ADVANCE MOVES -----------------

export type AdvanceMove = {
  combinator: AdvanceCombinator;
  from: number;
  to: number;
  run: AdvanceFn;
  test: CompoundTestFn;
  first?: AdvanceFirstFn;
  debug?: string;
};

type AdvanceCombinator = '>' | '+' | '~';

type AdvanceFn = (frontier: Element[], rc: RuntimeCache | null) => Element[];
type AdvanceFirstFn = (frontier: Element[], rc: RuntimeCache | null) => Element | null;

export function buildAdvanceMove(chain: Chain, from: number, snap: Snapshot): AdvanceMove | null {
  const to = from + 1;
  if (to >= chain.length) return null;

  const rel = chain[to];
  const { combinator } = rel;

  if (combinator === null) {
    throw new Error(`Missing combinator at chain relation ${to} in frontier advance move`);
  }

  if (combinator === ' ') return null;

  const test = compileStepTest(rel, snap);
  const run = buildAdvanceFn(combinator, test);

  const move: AdvanceMove = { from, to, run, combinator, test };

  return move;
}

function buildAdvanceFn(combinator: AdvanceCombinator, test: CompoundTestFn): AdvanceFn {
  switch (combinator) {
    case '>': return (frontier, rc) => advanceChildren(frontier, test, rc);
    case '+': return (frontier, rc) => advanceNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => advanceFollowingSiblings(frontier, test, rc);
  }
}

function advanceNextSibling(frontier: Element[], proof: CompoundTestFn, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && proof(candidate, rc)) out[++j] = candidate;
  }

  return out;
}

function advanceFollowingSiblings(frontier: Element[], proof: CompoundTestFn, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();

  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (proof(candidate, rc) && !seen.has(candidate)) {
        seen.add(candidate);
        out[out.length] = candidate;
      }
    }
  }

  return out;
}

function advanceChildren(frontier: Element[], test: CompoundTestFn, rc: RuntimeCache | null): Element[] {
  const out: Element[] = [];
  let j = -1;

  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) out[++j] = candidate;
    }
  }

  return out;
}

export function buildAdvanceFirstFn(combinator: AdvanceCombinator, test: CompoundTestFn): AdvanceFirstFn {
  switch (combinator) {
    case '>': return (frontier, rc) => firstChild(frontier, test, rc);
    case '+': return (frontier, rc) => firstNextSibling(frontier, test, rc);
    case '~': return (frontier, rc) => firstFollowingSibling(frontier, test, rc);
  }
}


function firstNextSibling(frontier: Element[], test: CompoundTestFn, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    const candidate = frontier[i].nextElementSibling;
    if (candidate && test(candidate, rc)) return candidate;
  }

  return null;
}

function firstFollowingSibling(frontier: Element[], test: CompoundTestFn, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].nextElementSibling; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}

function firstChild(frontier: Element[], test: CompoundTestFn, rc: RuntimeCache | null): Element | null {
  for (let i = 0; i < frontier.length; i++) {
    for (let candidate = frontier[i].firstElementChild; candidate; candidate = candidate.nextElementSibling) {
      if (test(candidate, rc)) return candidate;
    }
  }

  return null;
}
