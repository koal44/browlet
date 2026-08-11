export const treeScopeBrand: unique symbol = Symbol('TreeScope');

/**
 * An opaque identity for a document or shadow-tree CSS scope.
 *
 * DOM integrations own the relationship between their roots and these tokens.
 * The style engine only compares and carries them as declaration provenance.
 */
export type TreeScope = {
  readonly [treeScopeBrand]: true;
};

export function createTreeScope(): TreeScope {
  return Object.freeze({ [treeScopeBrand]: true });
}
