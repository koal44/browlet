declare const treeScopeBrand: unique symbol;

/**
 * An opaque identity for a document or shadow-tree CSS scope.
 *
 * DOM integrations own the relationship between their roots and these tokens.
 * The style engine only compares and carries them as declaration provenance.
 */
export type TreeScope = {
  readonly [treeScopeBrand]: never;
};

export function createTreeScope(): TreeScope {
  return Object.freeze({}) as TreeScope;
}
