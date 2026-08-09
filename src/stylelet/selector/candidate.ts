import type { RuntimeCache } from './runtimeCache';

export type CompiledMatcher = {
  element: CandidateElementPredicate;
  subject?: CandidateSubjectPredicate;
  cost: number;
  usesCache: boolean;
  usesTriMatch: boolean;
};

export type CandidateElementPredicate = (
  element: Element,
  runtimeCache: RuntimeCache | null,
) => boolean;

export type CandidateSubjectPredicate = (
  element: Element,
  runtimeCache: RuntimeCache | null,
  kind: SubjectKind,
) => TriMatch;

export type TriMatch = true | false | null;

export const enum SubjectKind {
  Element = 0,
  HostElement = 1,
}

export function asSubjectPredicate(
  matcher: CompiledMatcher,
): CandidateSubjectPredicate {
  if (matcher.subject !== undefined) return matcher.subject;

  return (element, runtimeCache, subject) =>
    subject === SubjectKind.Element
      ? matcher.element(element, runtimeCache)
      : null;
}

export function triAnd(left: TriMatch, right: TriMatch): TriMatch {
  if (left === null || right === null) return null;
  if (left === false || right === false) return false;
  return true;
}

export function triOr(left: TriMatch, right: TriMatch): TriMatch {
  if (left === true || right === true) return true;
  if (left === false || right === false) return false;
  return null;
}
