import type { ElementImpl } from '../../dom/nodes/element';
import type { Origin } from '../../../url/index';
import { InternalError } from '../../../infra/internal-error';

/** Placeholder state for a document's policy-controlled feature permissions. */
// https://w3c.github.io/webappsec-permissions-policy/#permissions-policy
// TODO: Populate declared and inherited policies when feature-policy processing is implemented.
export class PermissionsPolicy {
  /** Create policy state for the document's embedding element and origin. */
  // https://w3c.github.io/webappsec-permissions-policy/#create-for-navigable
  static create(embedder: ElementImpl | null, _origin: Origin): PermissionsPolicy {
    if (embedder !== null) {
      throw new InternalError('Embedded permissions-policy creation is not implemented');
    }
    return new PermissionsPolicy();
  }
}
