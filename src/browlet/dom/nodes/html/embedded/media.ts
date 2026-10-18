import { attr, defineInterface, idlType, impl, reflectEnumerated, xattr } from '../../../../../web-idl/index';

import { loadingAttribute } from '../attributes/index';

import { HTMLElementImpl } from '../html-element';

/** Loading policy shared by audio and video elements. */
// https://html.spec.whatwg.org/multipage/media.html#htmlmediaelement
export class HTMLMediaElementImpl extends HTMLElementImpl {
  /** Suspended media-resource loading steps, installed by resource selection. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-load-resumption-steps
  // PROVISIONAL: revisit callbacks versus retained load state when the loader exists; see loader/ROADMAP.md.
  lazyLoadResumptionSteps: (() => void) | null = null;

  static is(value: unknown): value is HTMLMediaElementImpl {
    return value instanceof HTMLMediaElementImpl;
  }

  /** Lazy loading is disabled without scripting, even for an explicit lazy attribute. */
  // https://html.spec.whatwg.org/multipage/urls-and-fetching.html#will-lazy-load-element-steps
  // https://html.spec.whatwg.org/multipage/webappapis.html#concept-n-noscript
  willLazyLoad(): boolean {
    if (!this.env.isScriptingEnabled() || this.nodeDocument.browsingContext === null) return false;
    return loadingAttribute.getState(this.getAttributeNS(null, 'loading')) === 'lazy';
  }

  override attributeChanged(
    localName: string, oldValue: string | null, value: string | null, namespace: string | null,
  ): void {
    super.attributeChanged(localName, oldValue, value, namespace);
    // https://html.spec.whatwg.org/multipage/media.html#attr-media-loading
    if (namespace !== null || localName !== 'loading' ||
      loadingAttribute.getState(oldValue) !== 'lazy' || loadingAttribute.getState(value) !== 'eager') return;
    this.resumeLazyLoading();
  }

  /** Resume resource loading after a change to eager; video also resumes its poster. */
  // https://html.spec.whatwg.org/multipage/media.html#attr-media-loading
  protected resumeLazyLoading(): void {
    const steps = this.lazyLoadResumptionSteps;
    this.lazyLoadResumptionSteps = null;
    steps?.();
  }
}

/*
 * [Exposed=Window]
 * interface HTMLMediaElement : HTMLElement {
 *
 *   // error state
 *   readonly attribute MediaError? error;
 *
 *   // network state
 *   [CEReactions, ReflectURL] attribute USVString src;
 *   attribute MediaProvider? srcObject;
 *   readonly attribute USVString currentSrc;
 *   [CEReactions] attribute DOMString? crossOrigin;
 *   const unsigned short NETWORK_EMPTY = 0;
 *   const unsigned short NETWORK_IDLE = 1;
 *   const unsigned short NETWORK_LOADING = 2;
 *   const unsigned short NETWORK_NO_SOURCE = 3;
 *   readonly attribute unsigned short networkState;
 *   [CEReactions] attribute DOMString preload;
 *   readonly attribute TimeRanges buffered;
 *   undefined load();
 *   CanPlayTypeResult canPlayType(DOMString type);
 *
 *   // ready state
 *   const unsigned short HAVE_NOTHING = 0;
 *   const unsigned short HAVE_METADATA = 1;
 *   const unsigned short HAVE_CURRENT_DATA = 2;
 *   const unsigned short HAVE_FUTURE_DATA = 3;
 *   const unsigned short HAVE_ENOUGH_DATA = 4;
 *   readonly attribute unsigned short readyState;
 *   readonly attribute boolean seeking;
 *
 *   // playback state
 *   attribute double currentTime;
 *   undefined fastSeek(double time);
 *   readonly attribute unrestricted double duration;
 *   object getStartDate();
 *   readonly attribute boolean paused;
 *   attribute double defaultPlaybackRate;
 *   attribute double playbackRate;
 *   attribute boolean preservesPitch;
 *   readonly attribute TimeRanges played;
 *   readonly attribute TimeRanges seekable;
 *   readonly attribute boolean ended;
 *   [CEReactions, Reflect] attribute boolean autoplay;
 *   [CEReactions, Reflect] attribute boolean loop;
 *   Promise<undefined> play();
 *   undefined pause();
 *
 *   // controls
 *   [CEReactions, Reflect] attribute boolean controls;
 *   attribute double volume;
 *   attribute boolean muted;
 *   [CEReactions, Reflect="muted"] attribute boolean defaultMuted;
 *   [CEReactions] attribute DOMString loading;
 *
 *   // tracks
 *   [SameObject] readonly attribute AudioTrackList audioTracks;
 *   [SameObject] readonly attribute VideoTrackList videoTracks;
 *   [SameObject] readonly attribute TextTrackList textTracks;
 *   TextTrack addTextTrack(TextTrackKind kind, optional DOMString label = "", optional DOMString language = "");
 * };
 */
export const htmlMediaElementIDL = defineInterface({
  name: 'HTMLMediaElement',
  inherits: 'HTMLElement',
  exposed: 'Window',
  implementation: impl(HTMLMediaElementImpl),
  members: [
    // PROVISIONAL: [CEReactions] entry/exit awaits HTML custom-element reaction delivery.
    attr('loading', idlType.DOMString, xattr('CEReactions', reflectEnumerated(loadingAttribute))),
  ],
});
