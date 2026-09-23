import { describe, expect, it } from 'vitest';

import { UserAgent } from '../../src/browlet/user-agent';
import { createNewBrowsingContextAndDocument } from '../../src/browlet/browsing/browsing-context';
import type { FetchUserAgent } from '../../src/fetch/infrastructure';
import { RequestImpl } from '../../src/fetch/request';
import { FetchResponse } from '../../src/fetch/response';
import { BlobImpl } from '../../src/file/blob';
import { URLImpl } from '../../src/url/api';
import { obtainURLOrigin } from '../../src/url/url';
import { createFetchWindow } from './fetch-fixture';

describe('File API §8.4: URL object URL methods', () => {
  it('registers Blobs and Files through the Window URL constructor and its legacy alias', () => {
    const { window, context, environment } = createWindow();
    const file = new window.File(['file'], 'example.txt');
    const blob = new window.Blob(['blob'], { type: 'text/plain' });

    expect(Reflect.get(window, 'webkitURL')).toBe(window.URL);
    expect(window.URL.createObjectURL.length).toBe(1);
    expect(window.URL.revokeObjectURL.length).toBe(1);
    for (const object of [blob, file]) {
      const url = window.URL.createObjectURL(object);
      expect(url).toMatch(/^blob:https:\/\/example\.test\/[0-9a-f-]+$/u);
      const entry = environment.userAgent.parseURL(url).url!.blobURLEntry;
      expect(entry!.environment).toBe(environment);
      expect(environment.userAgent.obtainBlobObject(entry, environment)).toBe(context.unwrap(object, BlobImpl));
      expect(window.URL.createObjectURL(object)).not.toBe(url);
    }
  });

  it('rejects missing arguments and objects outside the declared Blob interface', () => {
    const { window } = createWindow();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Static Web IDL methods accept an absent receiver.
    const { createObjectURL, revokeObjectURL } = window.URL;
    expect(() => { Reflect.apply(createObjectURL, undefined, []); }).toThrow(window.TypeError);
    for (const object of [undefined, null, 'blob', {}, new Blob(['host blob'])]) {
      expect(() => { Reflect.apply(createObjectURL, undefined, [object]); }).toThrow(window.TypeError);
    }
    expect(() => { Reflect.apply(revokeObjectURL, undefined, []); }).toThrow(window.TypeError);
    expect(() => { Reflect.apply(revokeObjectURL, undefined, [Symbol()]); }).toThrow(window.TypeError);
  });

  it('uses the static method realm for creation, independent of its receiver and the Blob owner', () => {
    const creator = createWindow();
    const other = createWindow(new UserAgent(), 'https://other.test/');
    const blob = new other.window.Blob(['cross-realm']);
    const url = creator.window.URL.createObjectURL.call(other.window.URL, blob);
    const entry = creator.environment.userAgent.parseURL(url).url!.blobURLEntry;

    expect(url).toMatch(/^blob:https:\/\/example\.test\//u);
    expect(entry!.environment).toBe(creator.environment);
    expect(creator.environment.userAgent.obtainBlobObject(entry, creator.environment))
      .toBe(other.context.unwrap(blob, BlobImpl));
    expect(other.environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });

  it('converts a revocation argument once and parses it before removing the registration', () => {
    const { window, environment } = createWindow();
    const url = window.URL.createObjectURL(new window.Blob([]));
    let conversions = 0;
    const argument = { toString() { conversions++; return ` \t${url}\n`; } };

    expect(window.URL.revokeObjectURL.call(undefined, argument as unknown as string)).toBeUndefined();
    expect(conversions).toBe(1);
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
    expect(() => window.URL.revokeObjectURL(url)).not.toThrow();
  });

  it('leaves invalid, non-Blob, unknown, and fragment-suffixed revocations harmless', () => {
    const { window, environment } = createWindow();
    const url = window.URL.createObjectURL(new window.Blob([]));
    const entry = environment.userAgent.parseURL(url).url!.blobURLEntry;
    for (const input of ['https://[', 'not a URL', 'https://example.test/', 'blob:null/unknown', `${url}#fragment`]) {
      expect(() => window.URL.revokeObjectURL(input)).not.toThrow();
      expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBe(entry);
    }
    window.URL.revokeObjectURL(url);
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });

  it('allows another same-partition Window to revoke but denies other partitions and user agents', () => {
    const userAgent = new UserAgent();
    const creator = createWindow(userAgent);
    const samePartition = createWindow(userAgent);
    const otherPartition = createWindow(userAgent, 'https://other.test/');
    const otherAgent = createWindow();
    const url = creator.window.URL.createObjectURL(new creator.window.Blob([]));
    const entry = userAgent.parseURL(url).url!.blobURLEntry;

    otherPartition.window.URL.revokeObjectURL(url);
    otherAgent.window.URL.revokeObjectURL(url);
    expect(userAgent.parseURL(url).url!.blobURLEntry).toBe(entry);
    samePartition.window.URL.revokeObjectURL(url);
    expect(userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });

  it('uses the revocation method realm even when called with another Window URL as receiver', () => {
    const userAgent = new UserAgent();
    const creator = createWindow(userAgent);
    const other = createWindow(userAgent, 'https://other.test/');
    const url = creator.window.URL.createObjectURL(new creator.window.Blob([]));

    other.window.URL.revokeObjectURL.call(creator.window.URL, url);
    expect(userAgent.parseURL(url).url!.blobURLEntry).not.toBeNull();
    creator.window.URL.revokeObjectURL.call(other.window.URL, url);
    expect(userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });

  it('keeps registration and authorized revocation available when storage APIs are disabled', () => {
    const { window, environment } = createWindow();
    environment.userAgent.storageEnabled = false;
    const url = window.URL.createObjectURL(new window.Blob([]));
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).not.toBeNull();
    window.URL.revokeObjectURL(url);
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });
});

describe('Blob URLs at the URL and Fetch boundaries', () => {
  it('retains opaque origin identity in browser URL parsing, including with a fragment', () => {
    const { window, environment } = createWindow(new UserAgent(), null);
    const url = window.URL.createObjectURL(new window.Blob([]));
    const record = environment.userAgent.parseURL(`${url}#fragment`).url!;

    expect(url).toMatch(/^blob:null\//u);
    expect(record.fragment).toBe('fragment');
    expect(record.blobURLEntry).not.toBeNull();
    expect(obtainURLOrigin(record)).toBe(environment.origin);
    window.URL.revokeObjectURL(url);
    expect(obtainURLOrigin(record)).toBe(environment.origin);
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
  });

  it('keeps the URL author API on the basic parser without capturing store entries', () => {
    const { window, context, environment } = createWindow(new UserAgent(), null);
    const url = window.URL.createObjectURL(new window.Blob([]));
    const constructed = new window.URL(url);
    const parsed = window.URL.parse(url)!;
    const assigned = new window.URL('https://example.test/');
    assigned.href = url;

    expect(window.URL.canParse(url)).toBe(true);
    for (const object of [constructed, parsed, assigned]) {
      expect(object.origin).toBe('null');
      expect(context.unwrap(object, URLImpl)!.getOrigin()).not.toBe(environment.origin);
    }
  });

  it('preserves an existing Request and its clone across revocation without a second lookup', () => {
    const { window, context, environment } = createWindow();
    const blob = new window.Blob(['retained bytes']);
    const url = window.URL.createObjectURL(blob);
    const request = new window.Request(`${url}#fragment`);
    const record = context.unwrap(request, RequestImpl)!.getRequest();
    const entry = record.currentURL.blobURLEntry;
    const userAgent: FetchUserAgent = record.userAgent;

    expect(entry).not.toBeNull();
    window.URL.revokeObjectURL(url);
    const clone = context.unwrap(request.clone(), RequestImpl)!.getRequest();
    expect(clone.currentURL.blobURLEntry).toBe(entry);
    expect(userAgent.obtainBlobObject(entry, environment)).toBe(context.unwrap(blob, BlobImpl));
    expect(userAgent.obtainBlobObject(clone.currentURL.blobURLEntry, environment))
      .toBe(context.unwrap(blob, BlobImpl));
    const fresh = context.unwrap(new window.Request(url), RequestImpl)!.getRequest();
    expect(fresh.currentURL.blobURLEntry).toBeNull();
    expect(userAgent.obtainBlobObject(fresh.currentURL.blobURLEntry, environment)).toBeNull();
  });

  it('captures a cross-partition registration while denying ordinary Fetch acquisition', () => {
    const userAgent = new UserAgent();
    const creator = createWindow(userAgent);
    const other = createWindow(userAgent, 'https://other.test/');
    const blob = new creator.window.Blob([]);
    const url = creator.window.URL.createObjectURL(blob);
    const request = other.context.unwrap(new other.window.Request(url), RequestImpl)!.getRequest();
    const entry = request.currentURL.blobURLEntry;

    expect(entry).not.toBeNull();
    expect(request.userAgent.obtainBlobObject(entry, other.environment)).toBeNull();
    expect(request.userAgent.obtainBlobObject(entry, 'top-level-navigation'))
      .toBe(creator.context.unwrap(blob, BlobImpl));
  });

  it('captures a Blob registration when parsing a redirect Location for the owning user agent', () => {
    const { window, environment } = createWindow();
    const url = window.URL.createObjectURL(new window.Blob([]));
    const response = new FetchResponse();
    response.status = 302;
    response.headerList.append('Location', url);
    const location = response.getLocationURL('request-fragment', environment.userAgent)!;

    expect(location.fragment).toBe('request-fragment');
    expect(location.blobURLEntry).not.toBeNull();
    window.URL.revokeObjectURL(url);
    expect(environment.userAgent.obtainBlobObject(location.blobURLEntry, environment)).not.toBeNull();
  });

  it('retains a frozen Blob base URL after revocation', () => {
    const { window, environment, document } = createWindow(new UserAgent(), null);
    const url = window.URL.createObjectURL(new window.Blob([]));
    const base = window.document.createElement('base');
    base.href = url;
    window.document.head.appendChild(base);
    const entry = document.getBaseURL().blobURLEntry;
    expect(entry).not.toBeNull();

    window.URL.revokeObjectURL(url);
    expect(base.href).toBe(url);
    expect(document.getBaseURL().blobURLEntry).toBe(entry);
    expect(obtainURLOrigin(document.getBaseURL())).toBe(environment.origin);
  });

  // Requires HTML's creator browsing-context and Document-state inheritance.
  it.todo('retains a frozen Blob base URL when a new document inherits it after revocation', () => {
    const { window, environment, document } = createWindow(new UserAgent(), null);
    const url = window.URL.createObjectURL(new window.Blob([]));
    const base = window.document.createElement('base');
    base.href = url;
    window.document.head.appendChild(base);
    const entry = document.getBaseURL().blobURLEntry;
    expect(entry).not.toBeNull();

    window.URL.revokeObjectURL(url);
    const [, child] = createNewBrowsingContextAndDocument(document, null, document.browsingContext!.group!);
    expect(child.getBaseURL().blobURLEntry).toBe(entry);
    expect(obtainURLOrigin(child.getBaseURL())).toBe(environment.origin);
  });

  it('removes public registrations during Document destruction while retaining captured entries', () => {
    const { window, context, environment, document, queueTask, runTask } = createWindow();
    const blob = new window.Blob([]);
    const url = window.URL.createObjectURL(blob);
    const entry = environment.userAgent.parseURL(url).url!.blobURLEntry;

    queueTask(() => { document.destroy(); });
    runTask();
    expect(environment.userAgent.parseURL(url).url!.blobURLEntry).toBeNull();
    expect(environment.userAgent.obtainBlobObject(entry, environment)).toBe(context.unwrap(blob, BlobImpl));
  });
});

function createWindow(userAgent = new UserAgent(), url: string | null = 'https://example.test/') {
  const fixture = createFetchWindow(userAgent);
  const { realm, context, document } = fixture;
  if (url !== null) {
    document!.url = userAgent.parseURL(url).url!;
    document!.origin = obtainURLOrigin(document!.url);
  }
  return {
    window: realm.global as Window & typeof globalThis, context,
    queueTask: fixture.queueTask.bind(fixture), runTask: fixture.runTask.bind(fixture),
    environment: realm.environment, document: document!,
  };
}
