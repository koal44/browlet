import type {
  CandidateTest, IdSelector, ClassSelector, TagSelector, CandidateElementPredicate, CompoundSelector,
  BuildElementPredicate,
} from '../parser/parser';
import { asciiLower } from '../../infra/ascii';
import { asciiWhitespacePattern } from '../../infra/patterns';
import { cssIdentUnescape } from '../parser/escape';
import { checkClass, checkId, checkTag } from './runtime';

const TRUE_PREDICATE: CandidateElementPredicate = () => true;
const FALSE_PREDICATE: CandidateElementPredicate = () => false;

// id
export function emitIdTest(id: IdSelector): CandidateTest {
  const value = cssIdentUnescape(id.raw);
  return { buildElement: (ctx) => (e) => checkId(e, value, ctx), cost: id.cost };
}

// class
export function emitClassTest(cls: ClassSelector): CandidateTest {
  const value = cssIdentUnescape(cls.raw);

  if (asciiWhitespacePattern.test(value)) {
    return { buildElement: () => FALSE_PREDICATE, cost: 0 };
  }

  return { buildElement: (ctx) => (e) => checkClass(e, value, ctx), cost: cls.cost };
}

// tag
export function emitTagTest(tag: TagSelector): CandidateTest {
  const local = cssIdentUnescape(tag.localRaw);
  let build: BuildElementPredicate;

  if (local === '*') {
    build = () => TRUE_PREDICATE;
  } else {
    const lower = asciiLower(local);
    build = local === lower
      ? (ctx) => (e) => ctx.dom.getLocalName(e) === local
      : (ctx) => (e) => checkTag(e, lower, local, ctx);
  }

  if (tag.prefixRaw === '*') return { buildElement: build, cost: tag.cost };

  if (tag.prefixRaw === '') {
    return {
      buildElement: (ctx) => {
        const test = build(ctx);
        return (e, rc) => !ctx.dom.getNamespaceURI(e) && test(e, rc);
      },
      cost: tag.cost,
    };
  }

  return { buildElement: build, cost: tag.cost };
}

export function collectCompoundTests(compound: CompoundSelector): CandidateTest[] {
  const tests: CandidateTest[] = [];

  if (compound.id && !compound.id.seed) {
    tests.push(emitIdTest(compound.id));
  }

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      const cls = compound.classes[i]!;
      if (!cls.seed) tests.push(emitClassTest(cls));
    }
  }

  if (compound.tag && !compound.tag.seed) {
    tests.push(emitTagTest(compound.tag));
  }

  for (let i = 0; i < compound.tests.length; i++) {
    const test = compound.tests[i]!;
    tests.push(test);
  }

  return tests;
}
