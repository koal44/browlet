/** Placeholder for the document's permissions policy until feature-policy processing is implemented. */
// https://w3c.github.io/webappsec-permissions-policy/#permissions-policy
export type PermissionsPolicy = Record<never, never>;

/** Allocate independent placeholder policy state for a document. */
export function createPermissionsPolicy(): PermissionsPolicy {
  return {};
}
