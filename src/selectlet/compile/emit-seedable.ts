import type {
  CandidateTest, IdSelector, ClassSelector, TagSelector, CandidateBiPredicate, CompoundSelector,
  BuildBi,
} from '../parser/parser';
import { asciiLower, cssIdentUnescape } from '../../utils/css';
import { checkClass, checkId, checkTag } from './runtime';

const TRUE_PREDICATE: CandidateBiPredicate = () => true;
const FALSE_PREDICATE: CandidateBiPredicate = () => false;

// id
export function emitIdTest(id: IdSelector): CandidateTest {
  const value = cssIdentUnescape(id.raw);
  return { buildBi: (s) => (e) => checkId(e, value, s), cost: id.cost };
}

// class
export function emitClassTest(cls: ClassSelector): CandidateTest {
  const value = cssIdentUnescape(cls.raw);

  if (/[\t\n\f\r ]/.test(value)) {
    return { buildBi: () => FALSE_PREDICATE, cost: 0 };
  }

  return { buildBi: (s) => (e) => checkClass(e, value, s), cost: cls.cost };
}

// tag
export function emitTagTest(tag: TagSelector): CandidateTest {
  const local = cssIdentUnescape(tag.localRaw);
  let build: BuildBi;

  if (local === '*') {
    build = () => TRUE_PREDICATE;
  } else {
    const lower = asciiLower(local);
    build = local === lower
      ? (s) => (e) => s.getLocalName(e) === local
      : (s) => (e) => checkTag(e, lower, local, s);
  }

  if (tag.prefixRaw === '*') return { buildBi: build, cost: tag.cost };

  if (tag.prefixRaw === '') {
    return {
      buildBi: (s) => {
        const test = build(s);
        return (e, rc) => !s.getNamespaceURI(e) && test(e, rc);
      },
      cost: tag.cost,
    };
  }

  return { buildBi: build, cost: tag.cost };
}

export function collectCompoundTests(compound: CompoundSelector): CandidateTest[] {
  const tests: CandidateTest[] = [];

  if (compound.id && !compound.id.seed) {
    tests.push(emitIdTest(compound.id));
  }

  if (compound.classes) {
    for (let i = 0; i < compound.classes.length; i++) {
      const cls = compound.classes[i];
      if (!cls.seed) tests.push(emitClassTest(cls));
    }
  }

  if (compound.tag && !compound.tag.seed) {
    tests.push(emitTagTest(compound.tag));
  }

  for (let i = 0; i < compound.tests.length; i++) {
    tests.push(compound.tests[i]);
  }

  return tests;
}
