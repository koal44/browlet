import { HTML_NAMESPACE } from '../../../../../infra/index';
import { ctor, defineInterface, impl, xattr } from '../../../../../web-idl/core/index';

import { ElementTag, ContentCategory } from '../../element-definitions/index';

import { HTMLMediaElementImpl } from './media';

/** Video element's media and independent poster-loading continuations. */
// https://html.spec.whatwg.org/multipage/media.html#the-video-element
export class HTMLVideoElementImpl extends HTMLMediaElementImpl {
  static {
    this.prototype.tag = ElementTag.HTMLVideo;
    this.prototype.categories = [
      ContentCategory.Flow, ContentCategory.Phrasing, ContentCategory.Embedded, ContentCategory.Palpable,
    ];
  }

  /** Suspended poster-image loading, independent of the media resource. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#poster-lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained poster-load state when loading exists; see loader/ROADMAP.md.
  posterLazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLVideoElementImpl {
    return value instanceof HTMLVideoElementImpl;
  }

  override hasCategory(category: ContentCategory): boolean {
    if (category === ContentCategory.Interactive) return this.hasAttributeNS(null, 'controls');
    return super.hasCategory(category);
  }

  /** Capture both continuations before either can replace the other's state. */
  // https://html.spec.whatwg.org/multipage/media.html#attr-media-loading
  protected override resumeLazyLoading(): void {
    const steps = this.lazyLoadResumptionSteps;
    const posterSteps = this.posterLazyLoadResumptionSteps;
    if (steps !== null) {
      this.lazyLoadResumptionSteps = null;
      steps();
    }
    if (posterSteps !== null) {
      this.posterLazyLoadResumptionSteps = null;
      posterSteps();
    }
  }
}

/*
 * [Exposed=Window]
 * interface HTMLVideoElement : HTMLMediaElement {
 *   [HTMLConstructor] constructor();
 *
 *   [CEReactions, Reflect] attribute unsigned long width;
 *   [CEReactions, Reflect] attribute unsigned long height;
 *   readonly attribute unsigned long videoWidth;
 *   readonly attribute unsigned long videoHeight;
 *   [CEReactions, ReflectURL] attribute USVString poster;
 *   [CEReactions, Reflect] attribute boolean playsInline;
 *
 * };
 */
export const htmlVideoElementIDL = defineInterface({
  name: 'HTMLVideoElement',
  inherits: 'HTMLMediaElement',
  exposed: 'Window',
  implementation: impl(HTMLVideoElementImpl),
  namespaceURI: HTML_NAMESPACE,
  localNames: ['video'],
  members: [
    ctor([], xattr('HTMLConstructor')),
  ],
});
