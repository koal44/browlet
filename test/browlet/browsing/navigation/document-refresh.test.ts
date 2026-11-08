import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavigationParams, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLMetaElementImpl } from '../../../../src/browlet/dom/nodes/html/metadata/meta';
import { FetchResponse } from '../../../../src/fetch/index';
import { parseURL, serializeURL } from '../../../../src/url/index';
import { createManualUserAgent } from '../../../support/browlet-agent';

afterEach(() => { vi.restoreAllMocks(); });

describe('Document Refresh processing', () => {
  it('ignores a malformed Refresh header instead of preventing Document creation', () => {
    const { top, params } = fixture();
    params.response.headerList.append('Refresh', 'not-a-delay');
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    expect(document.URL).toBe('https://example.test/source');
    expect(document.willDeclarativelyRefresh).toBe(false);
  });

  it.each([
    '', ' \t', 'bogus', '-0', '+0', '1e0', '0x10', '0z',
    '0;url=javascript:window.bad=true', '0;url=https://[',
  ])('ignores invalid or script-executing input %j without consuming admission', (input) => {
    const { document, schedule } = documentFixture();
    document.processDeclarativeRefresh(input);
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(schedule).not.toHaveBeenCalled();
    document.processDeclarativeRefresh('0;url=/next');
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(schedule).toHaveBeenCalledOnce();
  });

  it.each([
    ['0', 0n, '/source'],
    ['9', 9n, '/source'],
    ['.8, /fraction', 0n, '/fraction'],
    ['3.5.7; url=/fraction', 3n, '/fraction'],
    ['0 /space', 0n, '/space'],
    ['0\t; \nUrL \t= "/quoted"ignored"/last"', 0n, '/quoted'],
    ['0;', 0n, '/source'],
    ['0;url=/valid', 0n, '/valid'],
    ['0;u=/partial', 0n, '/u=/partial'],
    ['0;ur=/partial', 0n, '/ur=/partial'],
    ['0;url /partial', 0n, '/url%20/partial'],
    ["0;url='/unclosed", 0n, '/unclosed'],
  ] as const)('parses %j into its exact delay and target', (input, seconds, path) => {
    const { document, schedule } = documentFixture();
    document.processDeclarativeRefresh(input);
    expect(schedule).toHaveBeenCalledOnce();
    const [delay, url, meta] = schedule.mock.calls[0]!;
    expect(delay).toBe(seconds);
    expect(serializeURL(url)).toBe(`https://example.test${path}`);
    expect(meta).toBeUndefined();
    expect(document.willDeclarativelyRefresh).toBe(true);
  });

  it('keeps large integer delays exact for the scheduling owner', () => {
    const { document, schedule } = documentFixture();
    const seconds = '9'.repeat(400);
    document.processDeclarativeRefresh(`${seconds};url=/later`);
    expect(schedule.mock.calls[0]![0]).toBe(BigInt(seconds));
  });

  it.each([
    ['0', 'https://example.test/source'],
    ['0;url=', 'https://base.test/path/'],
    ['0;url=""', 'https://base.test/path/'],
    ['0;url=child', 'https://base.test/path/child'],
  ])('distinguishes omitted and explicit URL input %j using the current base', (input, expected) => {
    const { document, schedule } = documentFixture();
    const root = document.createElement('html');
    const head = document.createElement('head');
    const base = document.createElement('base');
    base.setAttribute('href', 'https://base.test/path/');
    head.appendChild(base);
    root.appendChild(head);
    document.appendChild(root);
    document.processDeclarativeRefresh(input);
    const url = schedule.mock.calls[0]![1];
    base.setAttribute('href', 'https://changed.test/');
    expect(serializeURL(url)).toBe(expected);
  });

  it('uses the established Document encoding and retains the optional meta source', () => {
    const { document, schedule } = documentFixture();
    document.encoding = 'windows-1252';
    const meta = document.createElement('meta') as HTMLMetaElementImpl;
    document.processDeclarativeRefresh('0;url=/query?é', meta);
    const [, url, source] = schedule.mock.calls[0]!;
    expect(serializeURL(url)).toBe('https://example.test/query?%E9');
    expect(source).toBe(meta);
  });

  it('admits only the first valid refresh across header and meta inputs', () => {
    const { document, schedule } = documentFixture();
    const response = new FetchResponse();
    response.headerList.append('Refresh', '10;url=/first');
    document.processRefreshHeaders(response);
    const meta = document.createElement('meta') as HTMLMetaElementImpl;
    document.processDeclarativeRefresh('0;url=/second', meta);
    expect(schedule).toHaveBeenCalledOnce();
    expect(serializeURL(schedule.mock.calls[0]![1])).toBe('https://example.test/first');
  });

  it.each([
    [['0;url=/first', '0;url=/second'], '/first,%200;url=/second'],
    [['0;url=/same', '0;url=/same'], '/same,%200;url=/same'],
    [['', '0;url=/second'], null],
    [['bad', '0;url=/second'], null],
  ] as const)('processes combined Refresh fields %j', (values, path) => {
    const { document, schedule } = documentFixture();
    const response = new FetchResponse();
    response.headerList.append('REFRESH', values[0]);
    response.headerList.append('refresh', values[1]);
    document.processRefreshHeaders(response);
    if (path === null) {
      expect(document.willDeclarativelyRefresh).toBe(false);
      expect(schedule).not.toHaveBeenCalled();
    } else {
      expect(schedule).toHaveBeenCalledOnce();
      expect(serializeURL(schedule.mock.calls[0]![1])).toBe(`https://example.test${path}`);
    }
  });

  it('prepares header refresh after timing and before Early Hints and pre-media Link processing', () => {
    const { top, params } = fixture();
    params.response.headerList.append('Refresh', '0;url=/query?é');
    params.response.headerList.append('Content-Type', 'text/html; charset=windows-1252');
    const order: string[] = [];
    const schedule = vi.spyOn(DocumentImpl.prototype, 'scheduleDeclarativeRefresh')
      .mockImplementation(function(this: DocumentImpl, seconds, url, meta) {
        order.push('refresh');
        expect(this.env.realm.getAssociatedDocument()).toBe(this);
        expect(this.navigationTimingEntry).toBeDefined();
        expect(this.encoding).toBe('UTF-8');
        expect(this.willDeclarativelyRefresh).toBe(true);
        expect(seconds).toBe(0n);
        expect(serializeURL(url)).toBe('https://example.test/query?%C3%A9');
        expect(meta).toBeUndefined();
      });
    params.commitEarlyHints = (document) => {
      order.push('hints');
      expect(document.willDeclarativelyRefresh).toBe(true);
    };
    vi.spyOn(DocumentImpl.prototype, 'processLinkHeaders').mockImplementation((_response, phase) => { order.push(phase); });
    top.createAndInitializeDocument('html', 'text/html', params);
    expect(schedule).toHaveBeenCalledOnce();
    expect(order).toEqual(['refresh', 'hints', 'pre-media']);
  });

  it('accepts a header refresh without blocking later initialization callbacks', () => {
    const { top, params } = fixture();
    params.response.headerList.append('Refresh', '0;url=/next');
    const hints = params.commitEarlyHints = vi.fn();
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    expect(document.willDeclarativelyRefresh).toBe(true);
    expect(document.completelyLoadedTime).toBeNull();
    expect(hints).toHaveBeenCalledExactlyOnceWith(document);
  });

  it('continues initialization after rejecting a javascript Refresh target', () => {
    const { top, params } = fixture();
    params.response.headerList.append('Refresh', '0;url=javascript:window.bad=true');
    const hints = params.commitEarlyHints = vi.fn();
    const document = top.createAndInitializeDocument('html', 'text/html', params);
    expect(document.willDeclarativelyRefresh).toBe(false);
    expect(hints).toHaveBeenCalledExactlyOnceWith(document);
  });
});

/** Keep real Document/URL processing; inspect the scheduler's prepared inputs independently. */
function documentFixture() {
  const { top, params } = fixture();
  const document = top.createAndInitializeDocument('html', 'text/html', params);
  const schedule = vi.spyOn(document, 'scheduleDeclarativeRefresh').mockImplementation(() => {});
  return { document, schedule };
}

function fixture() {
  const top = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://example.test/source').url!);
  const params = new NavigationParams(response, new SandboxingFlagSet(), 0);
  params.coopEnforcementResult = {
    url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
    needsBrowsingContextGroupSwitch: false, wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
    currentContextIsNavigationSource: false,
  };
  return { top, params };
}
