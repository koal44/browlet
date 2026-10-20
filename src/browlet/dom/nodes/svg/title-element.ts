import { SVG_NAMESPACE } from '../../../../infra/index';
import { defineInterface, impl } from '../../../../web-idl/core/index';

import { ElementTag } from '../element-definitions/index';

import type { NodeImpl } from '../node';
import { SVGElementImpl } from './element';

/** Supplies the document title when it is a direct child of the SVG document root. */
// https://svgwg.org/svg2-draft/struct.html#InterfaceSVGTitleElement
// https://html.spec.whatwg.org/multipage/dom.html#document.title
export class SVGTitleElementImpl extends SVGElementImpl {
  static {
    this.prototype.tag = ElementTag.SVGTitle;
  }

  static is(value: unknown): value is SVGTitleElementImpl {
    return value instanceof SVGTitleElementImpl;
  }

  protected override insertionSteps(): void {
    super.insertionSteps();
    this.nodeDocument.updateTitleElement(this);
  }

  protected override removingSteps(): void {
    super.removingSteps();
    this.nodeDocument.updateTitleElement(this);
  }

  protected override movingSteps(isSubtreeRoot: boolean, oldAncestor: NodeImpl): void {
    super.movingSteps(isSubtreeRoot, oldAncestor);
    this.nodeDocument.updateTitleElement(this);
  }

  protected override childrenChanged(): void {
    super.childrenChanged();
    this.nodeDocument.updateTitleText(this);
  }

  protected override childrenMoved(): void {
    super.childrenMoved();
    this.nodeDocument.updateTitleText(this);
  }
}

/*
 * [Exposed=Window]
 * interface SVGTitleElement : SVGElement {
 * };
 */
export const svgTitleElementIDL = defineInterface({
  name: 'SVGTitleElement',
  inherits: 'SVGElement',
  exposed: 'Window',
  implementation: impl(SVGTitleElementImpl),
  namespaceURI: SVG_NAMESPACE,
  localNames: ['title'],
  members: [],
});
