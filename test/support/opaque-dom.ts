import { JSDOM } from 'jsdom';
import {
  standardDOM, type DOMOperations, type DOMNode, type DOMDocument, type DOMElement, type DOMDocumentFragment,
} from '../../src/infra/index';

interface OpaqueDOM {
  window: JSDOM['window'];
  document: DOMDocument;
  dom: DOMOperations;
  opaque(this: void, node: Document): DOMDocument;
  opaque(this: void, node: Element): DOMElement;
  opaque(this: void, node: DocumentFragment): DOMDocumentFragment;
  opaque(this: void, node: Node): DOMNode;
  close(): void;
}

/** A host whose nodes reject direct access; only the operations can reach the fixture DOM. */
export function createOpaqueDOM(html: string): OpaqueDOM {
  const { window } = new JSDOM(html, { url: 'https://example.test/#target' });
  const nodes = new WeakMap<Node, object>();
  const originals = new WeakMap<object, Node>();

  function opaque(this: void, node: Document): DOMDocument;
  function opaque(this: void, node: Element): DOMElement;
  function opaque(this: void, node: DocumentFragment): DOMDocumentFragment;
  function opaque(this: void, node: Node): DOMNode;
  function opaque(this: void, node: Node): DOMNode {
    let value = nodes.get(node);
    if (value) return value;
    value = new Proxy({}, {
      get(_target, key) { throw new Error(`Direct DOM access: ${String(key)}`); },
      has(_target, key) { throw new Error(`Direct DOM inspection: ${String(key)}`); },
    });
    nodes.set(node, value);
    originals.set(value, node);
    return value;
  }

  function unwrap(value: unknown): unknown {
    return typeof value === 'object' && value !== null ? originals.get(value) ?? value : value;
  }

  function wrap(value: unknown): unknown {
    if (value instanceof window.Node) return opaque(value);
    if (value && typeof value === 'object' && Symbol.iterator in value) {
      return Array.from(value as Iterable<unknown>, wrap);
    }
    return value;
  }

  // This test adapter translates each operation's inputs and outputs, never the engine's nodes.
  const operations: Record<string, (...args: unknown[]) => unknown> = {};
  const entries = Object.entries(standardDOM) as [string, (...args: unknown[]) => unknown][];
  for (const [name, operation] of entries) {
    operations[name] = (...args) => wrap(Reflect.apply(operation, standardDOM, args.map(unwrap)));
  }
  const dom = operations as unknown as DOMOperations;
  dom.listen = (document, type, listener) => {
    standardDOM.listen(originals.get(document)! as Document, type, (target) => listener(target && opaque(target as Node)));
  };
  dom.hasCustomState = (element, name) => dom.getAttribute(element, 'data-state') === name;
  return { window, document: opaque(window.document), dom, opaque, close: () => { window.close(); } };
}
