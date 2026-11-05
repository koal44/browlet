import { InternalError } from '../../infra/index';
import { defineInterface, idlType, impl, roAttr } from '../../web-idl/core/index';
import {
  obtainURLOrigin, serializeHost, serializeOrigin, serializeURL, serializeURLPath, type URLRecord,
} from '../../url/index';

import type { WorkerGlobalImpl } from './worker-global-scope';

/** Read-only URL view associated with one worker global. */
// https://html.spec.whatwg.org/multipage/workers.html#workerlocation
export class WorkerLocationImpl {
  /** Global whose final script URL is read by the location getters. */
  #global: WorkerGlobalImpl;

  constructor(global: WorkerGlobalImpl) {
    this.#global = global;
  }

  get href(): string { return serializeURL(this.#url); }
  get origin(): string { return serializeOrigin(obtainURLOrigin(this.#url)); }
  get protocol(): string { return `${this.#url.scheme}:`; }

  get host(): string {
    const url = this.#url;
    if (url.host === null) return '';
    const host = serializeHost(url.host);
    return url.port === null ? host : `${host}:${url.port}`;
  }

  get hostname(): string {
    const host = this.#url.host;
    return host === null ? '' : serializeHost(host);
  }

  get port(): string {
    const port = this.#url.port;
    return port === null ? '' : String(port);
  }

  get pathname(): string { return serializeURLPath(this.#url); }

  get search(): string {
    const query = this.#url.query;
    return query === null || query === '' ? '' : `?${query}`;
  }

  get hash(): string {
    const fragment = this.#url.fragment;
    return fragment === null || fragment === '' ? '' : `#${fragment}`;
  }

  /** Author code cannot observe a worker location before the script response URL is assigned. */
  get #url(): URLRecord {
    const url = this.#global.url;
    if (url === null) throw new InternalError('WorkerLocation requires the worker script URL');
    return url;
  }
}

/*
 * [Exposed=Worker]
 * interface WorkerLocation {
 *   stringifier readonly attribute USVString href;
 *   readonly attribute USVString origin;
 *   readonly attribute USVString protocol;
 *   readonly attribute USVString host;
 *   readonly attribute USVString hostname;
 *   readonly attribute USVString port;
 *   readonly attribute USVString pathname;
 *   readonly attribute USVString search;
 *   readonly attribute USVString hash;
 * };
 */
export const workerLocationIDL = defineInterface({
  name: 'WorkerLocation',
  exposed: 'Worker',
  implementation: impl(WorkerLocationImpl),
  members: [
    roAttr('href', idlType.USVString, { stringifier: true }),
    roAttr('origin', idlType.USVString),
    roAttr('protocol', idlType.USVString),
    roAttr('host', idlType.USVString),
    roAttr('hostname', idlType.USVString),
    roAttr('port', idlType.USVString),
    roAttr('pathname', idlType.USVString),
    roAttr('search', idlType.USVString),
    roAttr('hash', idlType.USVString),
  ],
});
