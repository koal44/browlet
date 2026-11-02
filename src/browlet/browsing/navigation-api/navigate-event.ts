import { InternalError, type InternalPromise } from '../../../infra/index';
import {
  arg, atArg, ctor, defineCallbackFunction, defineDictionary, defineEnumeration, defineInterface, dictMember,
  DOMExceptionImpl, emptyDictionary, idlType, impl, nullable, op, promise, reference, roAttr,
} from '../../../web-idl/core/index';
import type { FormDataImpl } from '../../../xhr/index';

import { ErrorEventImpl, EventImpl, type EventInit } from '../../dom/events/index';
import type { AbortControllerImpl, AbortSignalImpl } from '../../dom/abort/index';
import type { ElementImpl } from '../../dom/nodes/index';
import type { BrowletEnvironment } from '../../environment';
import type { SerializedRecord } from '../../scripting/structured-data/index';

import type { NavigationType } from './navigation';
import type { NavigationDestinationImpl } from './navigation-destination';
import type { NavigationPrecommitHandler } from './navigation-precommit-controller';

/** Navigation event data, interception choices, and cancellation. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigateevent
export class NavigateEventImpl extends EventImpl {
  /** Environment owning the event and its Window's Navigation. */
  env: BrowletEnvironment;
  /** Category of the requested navigation. */
  navigationType: NavigationType;
  /** Destination shared with the eventual transition. */
  destination: NavigationDestinationImpl;
  /** Whether interception is permitted for this request. */
  canIntercept: boolean;
  /** Whether the navigation originated in user interaction. */
  userInitiated: boolean;
  /** Whether only the URL fragment changes. */
  hashChange: boolean;
  /** Signal exposed to navigation handlers. */
  signal: AbortSignalImpl;
  /** Submitted form data, when applicable. */
  formData: FormDataImpl | null;
  /** Suggested download filename, or null for an ordinary navigation. */
  downloadRequest: string | null;
  /** Author-supplied value retained without cloning. */
  info: unknown;
  /** Whether the user agent supplies a visual transition. */
  hasUAVisualTransition: boolean;
  /** Element that initiated the navigation, if any. */
  sourceElement: ElementImpl | null;
  /** Stage reached by interception; commit, scrolling, and completion advance it after dispatch. */
  interceptionState: 'none' | 'intercepted' | 'committed' | 'scrolled' | 'finished' = 'none';
  /** Converted callbacks to run after dispatch, before committing the navigation. */
  navigationPrecommitHandlerList: NavigationPrecommitHandler[] = [];
  /** Converted callbacks to run after the navigation commits. */
  navigationHandlerList: NavigationInterceptHandler[] = [];
  /** Most recent explicit focus choice, or null for the default behavior. */
  focusResetBehavior: NavigationFocusReset | null = null;
  /** Most recent explicit scrolling choice, or null for the default behavior. */
  scrollBehavior: NavigationScrollBehavior | null = null;
  /** Controller installed by trusted event production; author construction supplies only a signal. */
  abortController: AbortControllerImpl | null = null;
  /** Serialized History state supplied by push/replace event production. */
  // TODO(HTML §7.2.6.10): The firing algorithm must supply the classic History API state.
  classicHistoryAPIState: SerializedRecord | null = null;

  constructor(type: string, eventInitDict: NavigateEventInit, env: BrowletEnvironment) {
    super(type, eventInitDict, env.realm.eventTimeStamp());
    this.env = env;
    // Internal event creation supplies {}, then initializes required attributes before dispatch.
    this.navigationType = eventInitDict.navigationType ?? 'push';
    this.destination = eventInitDict.destination;
    this.canIntercept = eventInitDict.canIntercept ?? false;
    this.userInitiated = eventInitDict.userInitiated ?? false;
    this.hashChange = eventInitDict.hashChange ?? false;
    this.signal = eventInitDict.signal;
    this.formData = eventInitDict.formData ?? null;
    this.downloadRequest = eventInitDict.downloadRequest ?? null;
    this.info = eventInitDict.info;
    this.hasUAVisualTransition = eventInitDict.hasUAVisualTransition ?? false;
    this.sourceElement = eventInitDict.sourceElement ?? null;
  }

  /** Register interception handlers and choices during trusted event dispatch. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigateevent-intercept
  intercept(options: NavigationInterceptOptions): void {
    this.performSharedChecks();
    if (!this.canIntercept) throw new DOMExceptionImpl('This navigation cannot be intercepted', 'SecurityError');
    if (!this.dispatching) throw new DOMExceptionImpl('The navigate event is not being dispatched', 'InvalidStateError');
    if (options.precommitHandler !== undefined) {
      // SPEC_CLASH(navigation-precommit-cancelable): Follow the algorithm/Blink/Gecko's InvalidStateError;
      // HTML's introductory prose instead says SecurityError. WebKit's enabled implementation also follows the algorithm.
      if (!this.cancelable) throw new DOMExceptionImpl('Precommit requires a cancelable navigation', 'InvalidStateError');
      this.navigationPrecommitHandlerList.push(options.precommitHandler);
    }
    if (this.interceptionState !== 'none' && this.interceptionState !== 'intercepted') {
      throw new InternalError('Interception must precede navigation commit');
    }
    this.interceptionState = 'intercepted';
    if (options.handler !== undefined) this.navigationHandlerList.push(options.handler);
    // HTML permits console warnings for overwritten choices; retain the latest value without warning.
    if (options.focusReset !== undefined) this.focusResetBehavior = options.focusReset;
    if (options.scroll !== undefined) this.scrollBehavior = options.scroll;
    // TODO(HTML §7.2.6.10): Event completion invokes the lists, commits, and applies focus/scroll choices.
  }

  /** Request the navigation's scroll processing after commit and before it has already scrolled. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-navigateevent-scroll
  scroll(): void {
    this.performSharedChecks();
    if (this.interceptionState !== 'committed') {
      throw new DOMExceptionImpl('The navigation is not awaiting scroll processing', 'InvalidStateError');
    }
    this.processScrollBehavior();
  }

  /** Require an active owning Document, a trusted event, and no cancellation. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigateevent-perform-shared-checks
  performSharedChecks(): void {
    if (!this.env.getAssociatedDocument()!.isFullyActive()) {
      throw new DOMExceptionImpl('The Document is not fully active', 'InvalidStateError');
    }
    if (!this.isTrusted) throw new DOMExceptionImpl('The navigate event is not trusted', 'SecurityError');
    if (this.defaultPrevented) throw new DOMExceptionImpl('The navigate event was canceled', 'InvalidStateError');
  }

  /** Apply history scroll restoration or the destination Document's initial/fragment scroll. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#process-scroll-behavior
  processScrollBehavior(): void {
    // TODO(HTML §7.2.6.10.5): Restore scroll position data for traversal, otherwise consult the
    // Document's indicated part and scroll to its beginning or fragment (CSSOM View integration).
    throw new InternalError('NavigateEvent scroll processing is not yet implemented');
  }

  /** Signal cancellation, notify Navigation, and reject its unfinished results. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#abort-a-navigateevent
  abort(reason: unknown): void {
    if (this.abortController === null) throw new InternalError('NavigateEvent has no abort controller');
    const navigation = this.env.getAssociatedDocument()!.getRelevantGlobalObject()!.navigation;
    navigation.ongoingNavigateEvent = null;
    const transition = navigation.transition;
    // SPEC_GAP(navigation-abort-tracker-name): HTML's unbound apiMethodTracker denotes the ongoing tracker.
    // SPEC_CLASH(navigation-abort-reentrancy): Like Gecko, settle the original tracker before callbacks.
    // HTML's later lookup can reject a new navigation; retain the original transition for the same reason.
    navigation.ongoingAPIMethodTracker?.rejectFinished(reason);
    this.abortController.abort(reason);
    const errorInfo = ErrorEventImpl.extractErrorInformation(reason);
    navigation.fireEvent('navigateerror', ErrorEventImpl, (event) => {
      (event as ErrorEventImpl).initialize(errorInfo);
    });
    transition?.reject(reason);
    if (navigation.transition === transition) navigation.transition = null;
  }
}

/** Constructor attributes; trusted event creation also relies on the constructor's defaults. */
export interface NavigateEventInit extends EventInit {
  navigationType?: NavigationType;
  destination: NavigationDestinationImpl;
  canIntercept?: boolean;
  userInitiated?: boolean;
  hashChange?: boolean;
  signal: AbortSignalImpl;
  formData?: FormDataImpl | null;
  downloadRequest?: string | null;
  info?: unknown;
  hasUAVisualTransition?: boolean;
  sourceElement?: ElementImpl | null;
}

/** Converted interception options; omitted choices preserve prior calls' values. */
export interface NavigationInterceptOptions {
  precommitHandler?: NavigationPrecommitHandler;
  handler?: NavigationInterceptHandler;
  focusReset?: NavigationFocusReset;
  scroll?: NavigationScrollBehavior;
}

/** Converted callback whose result and exceptions already use Web IDL's promise adaptation. */
export type NavigationInterceptHandler = () => InternalPromise<void>;
export type NavigationFocusReset = 'after-transition' | 'manual';
export type NavigationScrollBehavior = 'after-transition' | 'manual';

export const navigateEventIDL = defineInterface<BrowletEnvironment>({
  name: 'NavigateEvent', inherits: 'Event', exposed: 'Window',
  implementation: impl(NavigateEventImpl, { constructWith: [atArg(2, (env) => env)] }),
  members: [
    ctor([arg('type', idlType.DOMString), arg('eventInitDict', reference('NavigateEventInit'))]),
    roAttr('navigationType', reference('NavigationType')),
    roAttr('destination', reference('NavigationDestination')),
    roAttr('canIntercept', idlType.boolean), roAttr('userInitiated', idlType.boolean), roAttr('hashChange', idlType.boolean),
    roAttr('signal', reference('AbortSignal')), roAttr('formData', nullable(reference('FormData'))),
    roAttr('downloadRequest', nullable(idlType.DOMString)), roAttr('info', idlType.any),
    roAttr('hasUAVisualTransition', idlType.boolean), roAttr('sourceElement', nullable(reference('Element'))),
    op('intercept', idlType.undefined,
      [arg('options', reference('NavigationInterceptOptions'), { optional: true, default: emptyDictionary })],
    ),
    op('scroll', idlType.undefined),
  ],
});

export const navigateEventInitIDL = defineDictionary({
  name: 'NavigateEventInit', inherits: 'EventInit',
  members: [
    dictMember('navigationType', reference('NavigationType'), { default: 'push' }),
    dictMember('destination', reference('NavigationDestination'), { required: true }),
    dictMember('canIntercept', idlType.boolean, { default: false }),
    dictMember('userInitiated', idlType.boolean, { default: false }),
    dictMember('hashChange', idlType.boolean, { default: false }),
    dictMember('signal', reference('AbortSignal'), { required: true }),
    dictMember('formData', nullable(reference('FormData')), { default: null }),
    dictMember('downloadRequest', nullable(idlType.DOMString), { default: null }),
    dictMember('info', idlType.any),
    dictMember('hasUAVisualTransition', idlType.boolean, { default: false }),
    dictMember('sourceElement', nullable(reference('Element')), { default: null }),
  ],
});

export const navigationInterceptOptionsIDL = defineDictionary({
  name: 'NavigationInterceptOptions',
  members: [
    dictMember('precommitHandler', reference('NavigationPrecommitHandler')),
    dictMember('handler', reference('NavigationInterceptHandler')),
    dictMember('focusReset', reference('NavigationFocusReset')),
    dictMember('scroll', reference('NavigationScrollBehavior')),
  ],
});

export const navigationFocusResetIDL = defineEnumeration({
  name: 'NavigationFocusReset', values: ['after-transition', 'manual'],
});

export const navigationScrollBehaviorIDL = defineEnumeration({
  name: 'NavigationScrollBehavior', values: ['after-transition', 'manual'],
});

export const navigationInterceptHandlerIDL = defineCallbackFunction({
  name: 'NavigationInterceptHandler', returns: promise(idlType.undefined), arguments: [],
});
