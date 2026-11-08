import { atArg, defineInterface, impl } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

import { NavigatorIDMixin } from './identification';
import { NavigatorLanguageMixin } from './language';
import { NavigatorOnLineMixin } from './online';

/** Worker-specific navigator identity; never shares a Window's Navigator object. */
// https://html.spec.whatwg.org/multipage/workers.html#the-workernavigator-object
// Permissions and Storage need the worker settings integration.
export class WorkerNavigatorImpl {
  /** Relevant environment supplied by the owning worker global. */
  env: BrowletEnvironment;
  /** Identification behavior composed with the worker's own relevant settings. */
  #navigatorIDMixin: NavigatorIDMixin;
  /** Worker-owned language snapshot and task delivery. */
  #navigatorLanguageMixin: NavigatorLanguageMixin;
  /** Connectivity uses this worker's settings and event loop. */
  #navigatorOnLineMixin: NavigatorOnLineMixin;

  constructor(env: BrowletEnvironment) {
    this.env = env;
    this.#navigatorIDMixin = new NavigatorIDMixin(env);
    this.#navigatorLanguageMixin = new NavigatorLanguageMixin(env);
    this.#navigatorOnLineMixin = new NavigatorOnLineMixin(env);
  }

  get appCodeName(): string { return this.#navigatorIDMixin.appCodeName; }
  get appName(): string { return this.#navigatorIDMixin.appName; }
  get appVersion(): string { return this.#navigatorIDMixin.appVersion; }
  get platform(): string { return this.#navigatorIDMixin.platform; }
  get product(): string { return this.#navigatorIDMixin.product; }
  get userAgent(): string { return this.#navigatorIDMixin.userAgent; }

  get language(): string { return this.#navigatorLanguageMixin.language; }
  get languages(): readonly string[] { return this.#navigatorLanguageMixin.languages; }

  get onLine(): boolean { return this.#navigatorOnLineMixin.onLine; }

  /** Queue selected language tags on this worker before their source changes. */
  queueLanguageChange(tags: readonly [string, ...string[]], emulationUpdated = false): void {
    this.#navigatorLanguageMixin.queueLanguageChange(tags, emulationUpdated);
  }

  /** Queue a transition on this worker after the producer changes its state. */
  queueOnlineStateChange(wasOnline: boolean): void {
    this.#navigatorOnLineMixin.queueOnlineStateChange(wasOnline);
  }

  /** Use the owning browser's processor count, including when it lives in another isolate. */
  get hardwareConcurrency(): number { return this.env.userAgent.hardwareConcurrency; }
}

/*
 * [Exposed=Worker]
 * interface WorkerNavigator {};
 */
export const workerNavigatorIDL = defineInterface<BrowletEnvironment>({
  name: 'WorkerNavigator',
  exposed: 'Worker',
  implementation: impl(WorkerNavigatorImpl, { constructWith: [atArg(0, (env) => env)] }),
  members: [],
});
