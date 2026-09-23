import type { FetchInsecureRequestsPolicy } from '../../../fetch/index';
import { hostsEqual, type Host, type URLRecord } from '../../../url/index';

/** Upgrade Insecure Requests' policy flag and navigation targets for one environment or browsing context. */
// https://w3c.github.io/webappsec-upgrade-insecure-requests/#insecure-requests-policy
// The flag and associated set travel together; false/true represent Do Not Upgrade/Upgrade.
export class InsecureRequestsPolicy implements FetchInsecureRequestsPolicy {
  /** Whether subresources, nested navigations, and form submissions require HTTPS. */
  upgrade = false;
  /** Host/port tuples whose top-level navigations are also opted into upgrading. */
  #navigationTargets: { host: Host | null; port: number | null; }[] = [];

  /** Apply an enforced directive for this resource; report-only directives must not call this. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#delivery
  enableFor(url: URLRecord): void {
    this.upgrade = true;
    if (!this.shouldUpgradeNavigation(url)) this.#navigationTargets.push({ host: url.host, port: url.port });
  }

  /** Match the draft's host/port tuple by value, independently of scheme and document.domain. */
  shouldUpgradeNavigation(url: URLRecord): boolean {
    return this.#navigationTargets.some(({ host, port }) => port === url.port &&
      (host === null || url.host === null ? host === url.host : hostsEqual(host, url.host)));
  }

  /** Copy inherited policy without allowing later directives to mutate the source's target set. */
  // https://w3c.github.io/webappsec-upgrade-insecure-requests/#nesting
  clone(): InsecureRequestsPolicy {
    const clone = new InsecureRequestsPolicy();
    clone.upgrade = this.upgrade;
    clone.#navigationTargets = [...this.#navigationTargets];
    return clone;
  }
}
