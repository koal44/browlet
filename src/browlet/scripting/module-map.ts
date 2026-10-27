import { urlsEqual, type URLRecord } from '../../url/index';

import type { ModuleScript, ModuleType } from './script';

/** Module results and pending callbacks, keyed by request URL and module type. */
// https://html.spec.whatwg.org/multipage/webappapis.html#module-map
export class ModuleMap {
  entries: ModuleMapEntry[] = [];

  get(url: URLRecord, type: ModuleType): ModuleMapValue | undefined {
    return this.entries.find(({ key }) => key[1] === type && urlsEqual(key[0], url))?.value;
  }

  set(url: URLRecord, type: ModuleType, value: ModuleMapValue): void {
    const entry = this.entries.find(({ key }) => key[1] === type && urlsEqual(key[0], url));
    if (entry === undefined) this.entries.push({ key: [url, type], value });
    else entry.value = value;
  }

  delete(url: URLRecord, type: ModuleType): void {
    const index = this.entries.findIndex(({ key }) => key[1] === type && urlsEqual(key[0], url));
    if (index !== -1) this.entries.splice(index, 1);
  }
}

export type ModuleFetchCallback = (script: ModuleScript | null) => void;
export type ModuleMapValue = ModuleScript | null | ModuleFetchCallback[];
export type ModuleMapKey = [URLRecord, ModuleType];
export type ModuleMapEntry = { key: ModuleMapKey; value: ModuleMapValue; };
