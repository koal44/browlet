import { arg, defineInterfaceMixin, idlType, nullable, op, reference } from '../../../web-idl/core/index';

/*
 * interface mixin NonElementParentNode {
 *   Element? getElementById(DOMString elementId);
 * };
 */
// https://dom.spec.whatwg.org/#interface-nonelementparentnode
export const nonElementParentNodeIDL = defineInterfaceMixin({
  name: 'NonElementParentNode',
  members: [op('getElementById', nullable(reference('Element')), [arg('elementId', idlType.DOMString)])],
});
