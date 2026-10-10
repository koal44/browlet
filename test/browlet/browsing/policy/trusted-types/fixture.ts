import type { Window as PlatformWindow, Element, Attr } from '../../../../../src/browlet/platform';
import type { CSPDisposition } from '../../../../../src/browlet/browsing/policy/csp/policy';
import { createCSPWindow } from '../csp/fixture';

/** Real Window APIs and policy state, with explicit delivery of queued CSP violations. */
export function createTrustedTypesWindow(serialized = "require-trusted-types-for 'script'", disposition: CSPDisposition = 'enforce') {
  const fixture = createCSPWindow(serialized, disposition);
  return { ...fixture, window: fixture.window as unknown as PlatformWindow & { TypeError: typeof TypeError; } };
}

/** Author-facing attachment routes that share the DOM set-an-attribute algorithm. */
export const attachments: [string, (element: Element, attribute: Attr) => Attr | null][] = [
  ['setAttributeNode', (element, attribute) => element.setAttributeNode(attribute)],
  ['setAttributeNodeNS', (element, attribute) => element.setAttributeNodeNS(attribute)],
  ['setNamedItem', (element, attribute) => element.attributes.setNamedItem(attribute)],
  ['setNamedItemNS', (element, attribute) => element.attributes.setNamedItemNS(attribute)],
];
