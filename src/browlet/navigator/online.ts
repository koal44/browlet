import { InternalError } from '../../infra/index';
import { defineInterfaceMixin, idlType, roAttr } from '../../web-idl/core/index';
import { isOffline } from '../../fetch/index';

import { EventTargetImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment/index';

/** Live Fetch connectivity and transition notifications for one Navigator. */
// https://html.spec.whatwg.org/multipage/system-state.html#navigator.online
export class NavigatorOnLineMixin {
  /** Relevant settings of the including Window or worker Navigator. */
  env: BrowletEnvironment;

  constructor(env: BrowletEnvironment) {
    this.env = env;
  }

  /** True means the browser might be online, not that a destination is reachable. */
  // https://html.spec.whatwg.org/multipage/system-state.html#dom-navigator-online
  get onLine(): boolean { return !isOffline(this.env); }

  /** Compare the producer's previous effective value after its connectivity/emulation change. */
  queueOnlineStateChange(wasOnline: boolean): void {
    const online = this.onLine;
    if (wasOnline === online) return;
    const type = online ? 'online' : 'offline';
    const global = this.env.globalImplementation;
    if (!EventTargetImpl.is(global)) throw new InternalError('Navigator connectivity changes require a Window or worker event target');
    // SPEC_CLASH(navigator-online-worker-notifications): Follow HTML/WebKit; Chromium's emulation probe changed worker onLine without events.
    // Capture the transition, not its eventual getter value: later changes do not cancel this event.
    this.env.queueTask('network', { run: () => { global.fireEvent(type); } });
  }
}

export const navigatorOnLineIDL = defineInterfaceMixin({
  name: 'NavigatorOnLine',
  members: [roAttr('onLine', idlType.boolean)],
});
