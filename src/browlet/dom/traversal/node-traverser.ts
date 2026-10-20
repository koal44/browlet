import { DOMExceptionImpl, DOMExceptionNames } from '../../../web-idl/core/index';

import type { NodeImpl } from '../nodes/index';
import type { DOMEnvironment } from '../environment';

import { FILTER_ACCEPT, FILTER_SKIP, type NodeFilterCallback } from './node-filter';

/** Shared filtering state; each iterator or walker owns its own active flag. */
// https://dom.spec.whatwg.org/#traversal
export abstract class NodeTraverser {
  /** Environment of the document which created this traverser. */
  env: DOMEnvironment;
  /** Fixed traversal boundary, independent of the current node's document. */
  root: NodeImpl;
  /** Node kinds eligible for callback filtering. */
  whatToShow: number;
  /** Converted author callback, or null to accept every eligible node. */
  filter: NodeFilterCallback | null;
  /** True only while this traverser's callback is being invoked and converted. */
  protected active = false;

  constructor(root: NodeImpl, whatToShow: number, filter: NodeFilterCallback | null, env: DOMEnvironment) {
    this.env = env;
    this.root = root;
    this.whatToShow = whatToShow;
    this.filter = filter;
  }

  /** Apply the node mask and author filter, restoring the active flag after exceptions. */
  // https://dom.spec.whatwg.org/#concept-node-filter
  protected filterNode(node: NodeImpl): number {
    if (this.active) throw new DOMExceptionImpl('', DOMExceptionNames.invalidState);
    if (!(this.whatToShow & (1 << (node.nodeType - 1)))) return FILTER_SKIP;
    if (this.filter === null) return FILTER_ACCEPT;
    this.active = true;
    try {
      return this.filter.acceptNode(node);
    } finally {
      this.active = false;
    }
  }
}
