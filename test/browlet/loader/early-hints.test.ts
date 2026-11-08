import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchHeaders } from '../../../src/fetch/headers';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL, obtainURLOrigin } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { BrowletEnvironmentBase } from '../../../src/browlet/environment/environment';
import { LinkProcessingOptions } from '../../../src/browlet/loader/links/options';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => vi.restoreAllMocks());

describe('HTML Early Hints preparation and commitment', () => {
  it.each(['', '<ignored>; rel=unknown'])('returns commit steps when no resource operation is needed: %s', (value) => {
    const { response, reservedEnv, document } = fixture();
    response.headerList = new FetchHeaders(value === '' ? [] : [['Link', value]]);
    const commit = reservedEnv.processEarlyHintHeaders(response);
    expect(commit).toBeTypeOf('function');
    expect(() => commit(document)).not.toThrow();
  });

  it('prepares all valid hints in order, skipping invalid ones and retaining incoming policy and environment', () => {
    const { response, reservedEnv, document } = fixture();
    response.headerList = new FetchHeaders([
      ['Content-Security-Policy', "style-src 'self'"], ['Referrer-Policy', 'origin'],
      ['Link', '<invalid>; rel=preload, <first,style.css>; rel="unknown preload"; as=STYLE; crossorigin; nonce="Secret"'],
      ['Link', '<https://other.test>; rel=preconnect; crossorigin=use-credentials'],
    ]);
    const prepared: LinkProcessingOptions[] = [];
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) { prepared.push(this); });
    vi.spyOn(LinkProcessingOptions.prototype, 'preconnect').mockImplementation(function(this: LinkProcessingOptions) { prepared.push(this); });
    const commit = reservedEnv.processEarlyHintHeaders(response);
    expect(prepared.map((options) => options.href)).toEqual(['first,style.css', 'https://other.test']);
    expect(prepared[0]).toMatchObject({
      initiator: 'early-hint', document: null, sourceSet: null, destination: 'style', crossorigin: 'anonymous', nonce: 'Secret',
    });
    expect(prepared[0]!.env).toBe(reservedEnv);
    expect(prepared[0]!.baseURL).toBe(response.url);
    expect(prepared[0]!.origin).toEqual(obtainURLOrigin(response.url!));
    expect(prepared[0]!.policyContainer.cspList?.selfOrigin).toEqual(obtainURLOrigin(response.url!));
    expect(prepared[0]!.policyContainer.referrerPolicy).toBe('origin');
    expect(prepared[0]!.policyContainer).toBe(prepared[1]!.policyContainer);
    expect(prepared[0]!.policyContainer).not.toBe(document.policyContainer);
    commit(document);
    expect(prepared.map((options) => options.document)).toEqual([document, document]);
  });

  it('uses a resource completion callback installed after preparation but before Document commitment', () => {
    const { response, reservedEnv, document } = fixture();
    response.headerList = new FetchHeaders([['Link', '<asset>; rel=preload; as=fetch']]);
    const ready = vi.fn();
    const options: LinkProcessingOptions[] = [];
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      options.push(this);
    });
    const commit = reservedEnv.processEarlyHintHeaders(response);
    const prepared = options[0]!;
    prepared.onDocumentReady = ready;
    expect(ready).not.toHaveBeenCalled();
    commit(document);
    expect(ready).toHaveBeenCalledExactlyOnceWith(document);
    expect(prepared.document).toBeNull();
  });
});

function fixture() {
  const userAgent = createManualUserAgent();
  const navigable = TopLevelTraversable.create(userAgent, null, '');
  const document = navigable.activeDocument!;
  const url = parseURL('https://destination.test/path/page').url!;
  const reservedEnv = BrowletEnvironmentBase.createForNavigation(navigable, url);
  const response = new FetchResponse();
  response.status = 103;
  response.urlList = [url];
  return { document, reservedEnv, response };
}
