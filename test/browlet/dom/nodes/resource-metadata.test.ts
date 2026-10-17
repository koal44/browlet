import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { FetchRequest } from '../../../../src/fetch/request';
import { FetchResponse } from '../../../../src/fetch/response';
import { copyURL, createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { project, unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

afterEach(() => vi.restoreAllMocks());

describe('Document.cookie', () => {
  it('shares the Fetch cookie store while excluding HttpOnly reads and writes', async () => {
    const browlet = await createBrowser();
    const document = unwrap<DocumentImpl>(browlet.document);
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'visible=server; Path=/');
    response.headerList.append('Set-Cookie', 'secret=server; Path=/; HttpOnly');
    response.parseAndStoreCookies(new FetchRequest(document.url, document.env, document.env.userAgent));

    expect(await browlet.evaluate(() => document.cookie)).toBe('visible=server');
    expect(await browlet.evaluate(() => {
      document.cookie = 'secret=overwritten; Path=/';
      document.cookie = 'forbidden=script; Path=/; HttpOnly';
      document.cookie = 'visible=script; Path=/';
      document.cookie = 'added=script; Path=/';
      return document.cookie;
    })).toBe('visible=script; added=script');

    const request = new FetchRequest(document.url, document.env, document.env.userAgent);
    request.appendCookieHeader();
    // Creation timestamps can tie; this assertion concerns membership, not their tie order.
    expect(request.headerList.get('Cookie')?.split('; ').sort()).toEqual([
      'added=script', 'secret=server', 'visible=script',
    ]);
  });

  it('uses the document URL for default paths, independently of a base element', async () => {
    const browlet = await createBrowser();
    expect(await browlet.evaluate(() => {
      const base = document.createElement('base');
      base.href = 'https://other.test/elsewhere/';
      document.head.append(base);
      document.cookie = 'root=1; Path=/';
      document.cookie = 'directory=2';
      document.cookie = 'foreign=3; Domain=other.test';
      return document.cookie;
    })).toBe('directory=2; root=1');

    await browlet.navigate('https://example.test/outside');
    expect(await browlet.evaluate(() => document.cookie)).toBe('root=1');
    await browlet.navigate('https://example.test/dir/next');
    expect(await browlet.evaluate(() => document.cookie)).toBe('directory=2; root=1');
  });

  // SPEC_CLASH(document-cookie-url-history): browsers retain the original cookie path after same-document URL changes.
  it('retains the cookie URL when the document URL changes', async () => {
    const browlet = await createBrowser();
    const document = unwrap<DocumentImpl>(browlet.document);
    await browlet.evaluate(() => { document.cookie = 'directory=1'; });

    // History is not implemented yet; apply the URL change it will perform.
    document.url.path = ['elsewhere', 'page'];
    expect(await browlet.evaluate(() => document.cookie)).toBe('directory=1');
    document.url = parseURL('https://example.test/another/page').url!;
    expect(await browlet.evaluate(() => {
      document.cookie = 'later=2';
      return document.cookie;
    })).toBe('directory=1; later=2');

    await browlet.navigate('https://example.test/dir/next');
    expect(await browlet.evaluate(() => document.cookie)).toBe('directory=1; later=2');
    await browlet.navigate('https://example.test/another/page');
    expect(await browlet.evaluate(() => document.cookie)).toBe('');
  });

  // SPEC_CLASH(document-cookie-averse): inherit a lookup URL, not a copy of the cookie store.
  it.each(['about:blank', 'about:srcdoc'])('uses an inherited cookie URL for %s', async (url) => {
    const browlet = await createBrowser();
    const parent = unwrap<DocumentImpl>(browlet.document);
    parent.cookie = 'directory=1';
    const traversable = TopLevelTraversable.create(parent.env.userAgent, null, '');
    const params = traversable.createNavigationParamsFromSource(parseURL(url).url!);
    // Supply the inputs still owned by missing iframe/initiator navigation.
    params.origin = parent.origin;
    params.cookieURL = copyURL(parent.cookieURL);
    const document = traversable.createAndInitializeDocument('html', 'text/html', params);
    const entry = traversable.createHistoryEntry(document, params);
    traversable.finalizeCrossDocumentNavigation('replace', params.userInvolvement, entry);
    const platform = project(document);

    expect(Reflect.get(platform, 'cookie')).toBe('directory=1');
    parent.cookie = 'directory=updated';
    expect(Reflect.get(platform, 'cookie')).toBe('directory=updated');
    const base = document.createElement('base');
    base.setAttribute('href', 'https://other.test/elsewhere/');
    document.appendChild(base);
    parent.url.path = ['elsewhere', 'page'];
    params.cookieURL.path = ['elsewhere', 'page'];
    expect(Reflect.set(platform, 'cookie', 'inherited=2')).toBe(true);
    expect(parent.cookie).toBe('directory=updated; inherited=2');

    await browlet.navigate('https://example.test/outside');
    expect(await browlet.evaluate(() => document.cookie)).toBe('');
    expect(Reflect.get(platform, 'cookie')).toBe('directory=updated; inherited=2');
  });

  // SPEC_CLASH(document-cookie-sandbox): Chromium/Firefox throw; WebKit silently denies sandboxed srcdoc access.
  it('throws for sandboxed srcdoc with an inherited HTTP cookie URL', async () => {
    const browlet = await createBrowser();
    const parent = unwrap<DocumentImpl>(browlet.document);
    parent.cookie = 'retained=1';
    const traversable = TopLevelTraversable.create(parent.env.userAgent, null, '');
    const params = traversable.createNavigationParamsFromSource(parseURL('about:srcdoc').url!);
    params.cookieURL = copyURL(parent.cookieURL);
    params.origin = createOpaqueOrigin();
    params.finalSandboxingFlagSet.add('sandboxed-origin');
    const document = traversable.createAndInitializeDocument('html', 'text/html', params);
    const platform = project(document);

    expect(() => { Reflect.get(platform, 'cookie'); }).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(() => Reflect.set(platform, 'cookie', 'blocked=1')).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    expect(parent.cookie).toBe('retained=1');
  });

  it('uses UTF-8 bytes, replaces invalid sequences, and preserves a leading BOM', async () => {
    const browlet = await createBrowser();
    const document = unwrap<DocumentImpl>(browlet.document);
    document.encoding = 'windows-1252';
    const value = '\uFEFFcafé=☕\uD800';
    expect(await browlet.evaluate((value) => {
      document.cookie = value;
      return document.cookie;
    }, value)).toBe('\uFEFFcafé=☕\uFFFD');

    const cookie = [...document.env.userAgent.cookieStore.cookies][0]!;
    expect(cookie.name).toBe('\xEF\xBB\xBFcaf\xC3\xA9');
    expect(cookie.value).toBe('\xE2\x98\x95\xEF\xBF\xBD');
    const response = new FetchResponse();
    response.headerList.append('Set-Cookie', 'malformed=\xFF');
    response.parseAndStoreCookies(new FetchRequest(document.url, document.env, document.env.userAgent));
    expect(await browlet.evaluate(() => document.cookie)).toBe('\uFEFFcafé=☕\uFFFD; malformed=\uFFFD');
  });

  it('uses the user-agent preference without deleting stored cookies or sharing another user agent', async () => {
    const browlet = await createBrowser();
    const { userAgent } = unwrap<DocumentImpl>(browlet.document).env;
    await browlet.evaluate(() => { document.cookie = 'retained=1'; });
    userAgent.cookiesEnabled = false;
    expect(await browlet.evaluate(() => {
      document.cookie = 'blocked=2';
      return document.cookie;
    })).toBe('');
    userAgent.cookiesEnabled = true;
    expect(await browlet.evaluate(() => document.cookie)).toBe('retained=1');

    const other = await createBrowser();
    expect(await other.evaluate(() => document.cookie)).toBe('');
  });

  it('applies Secure and expiration policy to script access', async () => {
    const browlet = await createBrowser();
    expect(await browlet.evaluate(() => {
      document.cookie = 'secure=1; Secure; Path=/';
      document.cookie = 'ordinary=2; Path=/';
      document.cookie = 'removed=3; Path=/';
      document.cookie = 'removed=; Max-Age=0; Path=/';
      return document.cookie;
    })).toBe('secure=1; ordinary=2');
    await browlet.navigate('http://example.test/dir/page');
    expect(await browlet.evaluate(() => {
      document.cookie = 'secure=overwritten; Path=/';
      document.cookie = 'rejected=3; Secure; Path=/';
      return document.cookie;
    })).toBe('ordinary=2');
    await browlet.navigate('https://example.test/dir/page');
    expect(await browlet.evaluate(() => document.cookie)).toBe('secure=1; ordinary=2');
  });

  it('throws realm-owned SecurityErrors for opaque HTTP(S) documents', async () => {
    const browlet = await createBrowser();
    const document = unwrap<DocumentImpl>(browlet.document);
    document.origin = createOpaqueOrigin();

    expect(await browlet.evaluate(() => {
      const results = [];
      for (const access of [() => document.cookie, () => { document.cookie = 'blocked=1'; }]) {
        try { access(); } catch (error) {
          results.push({ name: (error as DOMException).name, ownRealm: error instanceof DOMException });
        }
      }
      return results;
    })).toEqual([
      { name: 'SecurityError', ownRealm: true },
      { name: 'SecurityError', ownRealm: true },
    ]);
    expect(document.env.userAgent.cookieStore.cookies.size).toBe(0);
  });

  it('returns empty and ignores writes for detached documents, even with opaque origins', async () => {
    const browlet = await createBrowser();
    expect(await browlet.evaluate(() => {
      const detached = document.implementation.createHTMLDocument();
      detached.cookie = 'detached=1';
      return detached.cookie;
    })).toBe('');

    const detached = createTestDocument(unwrap<DocumentImpl>(browlet.document).env);
    detached.url = parseURL('https://example.test/dir/page').url!;
    detached.cookie = 'detached=1';
    expect(detached.cookie).toBe('');
    expect(detached.env.userAgent.cookieStore.cookies.size).toBe(0);
  });

  // No creator supplies an inherited cookie URL for these host-initiated navigations.
  it.each(['about:blank', 'about:srcdoc', 'data:text/html,opaque', 'file:///example.html', 'ftp://example.test/'])(
    'returns empty and ignores writes for a non-HTTP document (%s)', async (url) => {
      const browlet = await createBrowser();
      await browlet.evaluate(() => { document.cookie = 'retained=1'; });
      await browlet.navigate(url);
      const document = unwrap<DocumentImpl>(browlet.document);
      expect(await browlet.evaluate(() => {
        document.cookie = 'ignored=1';
        return document.cookie;
      })).toBe('');

      document.origin = createOpaqueOrigin();
      expect(await browlet.evaluate(() => {
        document.cookie = 'stillIgnored=1';
        return document.cookie;
      })).toBe('');
      expect(document.env.userAgent.cookieStore.cookies.size).toBe(1);
    },
  );
});

describe('Document.lastModified', () => {
  it('formats source time with zero-padded local components, including four-digit years', () => {
    const document = createTestDocument();
    const date = new Date(0);
    date.setFullYear(7, 1, 3);
    date.setHours(4, 5, 6, 789);
    document.lastModificationTime = date.getTime();

    expect(document.lastModified).toBe('02/03/0007 04:05:06');
    date.setFullYear(12026);
    document.lastModificationTime = date.getTime();
    expect(document.lastModified).toBe('02/03/12026 04:05:06');
  });

  it('reads the current time on each access when the source time is unknown', async () => {
    const browlet = new Browlet({ route: () => '' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 0, 2, 3, 4, 5).getTime());

    expect(unwrap<DocumentImpl>(browlet.document).lastModificationTime).toBeUndefined();
    expect(await browlet.evaluate(() => document.lastModified)).toBe('01/02/2026 03:04:05');
    now.mockReturnValue(new Date(2026, 0, 2, 3, 4, 8).getTime());
    expect(await browlet.evaluate(() => document.lastModified)).toBe('01/02/2026 03:04:08');
  });

  it('retains the response modification time during document initialization', () => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.test/page').url!);
    response.headerList.append('Last-Modified', 'Sun, 06 Nov 1994 08:49:37 GMT');
    const document = traversable.createAndInitializeDocument(
      'html', 'text/html', traversable.createNavigationParams(response),
    );

    expect(document.lastModificationTime).toBe(Date.UTC(1994, 10, 6, 8, 49, 37));
    const value = document.lastModified;
    expect(Reflect.get(project(document), 'lastModified')).toBe(value);
    // SPEC_CLASH(document-last-modified-timezone): the formatted local date must retain the source instant.
    expect(new Date(value).getTime()).toBe(document.lastModificationTime);
    response.headerList.set('Last-Modified', 'Sun, 06 Nov 1994 09:49:37 GMT');
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2030, 0, 1));
    expect(document.lastModified).toBe(value);
  });

  it.each([null, 'not a date'])('uses current time for an absent or invalid Last-Modified header (%j)', (header) => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.test/page').url!);
    if (header !== null) response.headerList.append('Last-Modified', header);
    const document = traversable.createAndInitializeDocument(
      'html', 'text/html', traversable.createNavigationParams(response),
    );
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 0, 2, 3, 4, 5).getTime());

    expect(document.lastModificationTime).toBeUndefined();
    expect(document.lastModified).toBe('01/02/2026 03:04:05');
  });
});

async function createBrowser(): Promise<Browlet> {
  const browlet = new Browlet({ route: () => '<!doctype html><title>Resource metadata</title>' });
  await browlet.navigate('https://example.test/dir/page');
  return browlet;
}
