import { HTML_NAMESPACE } from '../../../../../infra/index';
import { defineInterface, impl } from '../../../../../web-idl/index';

import { defineElementInterface } from '../../element';
import { HTMLMediaElementImpl } from './media';

/** Video element's media and independent poster-loading continuations. */
// https://html.spec.whatwg.org/multipage/media.html#the-video-element
// PROVISIONAL: poster fetching, playback, dimensions, and the remaining video API are not implemented.
export class HTMLVideoElementImpl extends HTMLMediaElementImpl {
  /** Suspended poster-image loading, independent of the media resource. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#poster-lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained poster-load state when loading exists; see loader/ROADMAP.md.
  posterLazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLVideoElementImpl {
    return value instanceof HTMLVideoElementImpl;
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

/* HTMLVideoElement inherits the implemented loading member from HTMLMediaElement. */
export const htmlVideoElementIDL = defineInterface({
  name: 'HTMLVideoElement',
  inherits: 'HTMLMediaElement',
  exposed: 'Window',
  implementation: impl(HTMLVideoElementImpl),
  members: [],
});

export const htmlVideoElementInterface = defineElementInterface({
  definition: htmlVideoElementIDL,
  localNames: ['video'],
  namespaceURI: HTML_NAMESPACE,
});
