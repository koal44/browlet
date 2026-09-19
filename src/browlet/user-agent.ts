import { BrowsingContextGroup } from './browsing/browsing-context';
import type { TopLevelTraversable } from './browsing/navigable';
import type { EventLoopOptions } from './scripting/event-loop';
import { ConnectionPool, HTTPCachePartitions, type FetchUserAgent } from '../fetch/index';

/*
 * HTML's user agent owns browsing context groups and the top-level
 * traversables normally presented as browser windows or tabs. Browlet is one
 * such host, but these collections outlive any individual realm or Document.
 */
export class UserAgent implements FetchUserAgent {
  connectionPool = new ConnectionPool();
  httpCachePartitions = new HTTPCachePartitions();
  browsingContextGroupSet = new Set<BrowsingContextGroup>();
  topLevelTraversableSet = new Set<TopLevelTraversable>();
  eventLoopOptions: EventLoopOptions | null;
  // PROVISIONAL: assumes connectivity until explicitly changed; host detection is not wired.
  assumeNoInternetConnectivity = false;

  constructor(eventLoopOptions: EventLoopOptions | null = null) {
    this.eventLoopOptions = eventLoopOptions;
  }

  createBrowsingContextGroup(): BrowsingContextGroup {
    const group = new BrowsingContextGroup(this);
    this.browsingContextGroupSet.add(group);
    return group;
  }

  appendTopLevelTraversable(traversable: TopLevelTraversable): void {
    this.topLevelTraversableSet.add(traversable);
  }

  removeTopLevelTraversable(traversable: TopLevelTraversable): void {
    this.topLevelTraversableSet.delete(traversable);
  }

  removeBrowsingContextGroup(group: BrowsingContextGroup): void {
    if (group.browsingContextSet.size !== 0) {
      throw new Error('A nonempty browsing context group cannot be removed');
    }

    this.browsingContextGroupSet.delete(group);
  }
}
