import { afterEach, describe, expect, it, vi } from 'vitest';

import { FetchResponse } from '../../../src/fetch/response';
import { parseURL, obtainURLOrigin, serializeURL } from '../../../src/url/index';
import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { PolicyContainer } from '../../../src/browlet/browsing/policy/index';
import { LinkProcessingOptions, translatePreloadDestination } from '../../../src/browlet/loader/links/options';
import { createManualUserAgent } from '../../support/browlet-agent';

afterEach(() => vi.restoreAllMocks());

describe('final-response Link preparation', () => {
  it('uses the receiving Document base, origin, policy, and environment in header order', () => {
    const { document, response } = responseFixture();
    const html = document.createElement('html');
    const head = document.createElement('head');
    const base = document.createElement('base');
    base.setAttribute('href', 'https://base.test/assets/');
    head.appendChild(base);
    html.appendChild(head);
    document.appendChild(html);
    response.headerList.append('Link', '<bad>; rel=preload, <first>; rel="unknown preload"; as=SCRIPT; crossorigin; nonce=Secret');
    response.headerList.append('Link', '<second>; rel=preconnect; crossorigin=use-credentials, <third>; rel=modulepreload');
    const prepared: LinkProcessingOptions[] = [];
    for (const method of ['preload', 'preconnect', 'modulepreload'] as const) {
      vi.spyOn(LinkProcessingOptions.prototype, method).mockImplementation(function(this: LinkProcessingOptions) {
        prepared.push(this);
      });
    }

    document.processLinkHeaders(response, 'pre-media');

    expect(prepared.map((options) => options.href)).toEqual(['first', 'second', 'third']);
    expect(prepared[0]).toMatchObject({
      initiator: 'link', destination: 'script', crossorigin: 'anonymous', nonce: 'Secret', sourceSet: null,
    });
    expect(prepared[1]!.crossorigin).toBe('use-credentials');
    for (const options of prepared) {
      expect(options.document).toBe(document);
      expect(options.env).toBe(document.env);
      expect(options.origin).toBe(document.origin);
      expect(options.policyContainer).toBe(document.policyContainer);
      expect(serializeURL(options.baseURL)).toBe('https://base.test/assets/');
      expect(options.onDocumentReady).toBeNull();
    }
  });

  it.each(['media', 'srcset', 'imagesrcset'])('defers a present %s attribute to the media phase, including empty values', (attribute) => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', `<deferred>; rel=preload; as=image; ${attribute}="", <early>; rel=preload; as=fetch`);
    const prepared: string[] = [];
    vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      prepared.push(this.href);
    });

    document.processLinkHeaders(response, 'pre-media');
    expect(prepared).toEqual(['early']);
    document.processLinkHeaders(response, 'media');
    expect(prepared).toEqual(['early', 'deferred']);
  });

  it('does not treat imagesizes alone as a media-phase input', () => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', '<asset>; rel=preload; as=image; imagesizes="100vw"');
    const prepared: LinkProcessingOptions[] = [];
    const preload = vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(function(this: LinkProcessingOptions) {
      prepared.push(this);
    });

    document.processLinkHeaders(response, 'pre-media');
    document.processLinkHeaders(response, 'media');

    expect(preload).toHaveBeenCalledOnce();
    expect(prepared[0]!.sourceSet).toBeNull();
  });

  it('accepts ASCII-whitespace media without inventing a device match', () => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', '<asset>; rel=preload; as=fetch; media=" \t\r\n\f"');
    const preload = vi.spyOn(LinkProcessingOptions.prototype, 'preload').mockImplementation(() => {});

    document.processLinkHeaders(response, 'media');

    expect(preload).toHaveBeenCalledOnce();
  });

  it.each(['all', '(min-width: 1px)', '\u00a0'])('reaches the explicit media-matching dependency for %j', (media) => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', `<asset>; rel=preload; as=fetch; media="${media}"`);

    expect(() => document.processLinkHeaders(response, 'pre-media')).not.toThrow();
    expect(() => document.processLinkHeaders(response, 'media')).toThrow('Link header media matching is not implemented');
  });

  it('reaches source-set construction only after valid option preparation', () => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', '<invalid>; rel=preload; imagesrcset="a 1x"; imagesizes=100vw');
    expect(() => document.processLinkHeaders(response, 'media')).not.toThrow();
    response.headerList.append('Link', '<image>; rel=preload; as=image; imagesrcset="a 1x"; imagesizes=100vw');

    expect(() => document.processLinkHeaders(response, 'pre-media')).not.toThrow();
    expect(() => document.processLinkHeaders(response, 'media')).toThrow('Link header image source-set construction is not implemented');
  });

  it.each([
    ['preload; as=fetch', 'Link preload fetching and Document commitment are not implemented'],
    ['preconnect', 'Link preconnect is not implemented'],
    ['modulepreload', 'Link modulepreload header integration is not implemented'],
  ])('reaches the existing resource dependency for %s', (relation, message) => {
    const { document, response } = responseFixture();
    response.headerList.append('Link', `<asset>; rel=${relation}`);

    expect(() => document.processLinkHeaders(response, 'pre-media')).toThrow(message);
  });
});

describe('Link header option preparation', () => {
  it('retains its supplied owners and HTML defaults', () => {
    const options = fixture();
    expect(options).toMatchObject({
      href: '', initiator: 'link', integrity: '', type: '', nonce: '', destination: '',
      crossorigin: 'no-cors', referrerPolicy: '', sourceSet: null, fetchPriority: 'auto', document: null, onDocumentReady: null,
    });
    const policy = options.policyContainer;
    expect(options.applyHeaderAttributes(new Map(), 'preconnect')).toBe(true);
    expect(options.policyContainer).toBe(policy);
  });

  it.each([
    ['fetch', ''], ['font', 'font'], ['image', 'image'], ['script', 'script'], ['style', 'style'], ['track', 'track'],
  ])('translates %s and accepts its mixed-case header value', (as, destination) => {
    expect(translatePreloadDestination(as)).toBe(destination);
    const options = fixture();
    expect(options.applyHeaderAttributes(new Map([['as', as.toUpperCase()]]), 'preload')).toBe(true);
    expect(options.destination).toBe(destination);
  });

  it.each([undefined, '', 'worker', 'audio', 'video', ' script ', 'invalid'])('rejects preload as=%s before applying other attributes', (as) => {
    const options = fixture();
    const attributes = new Map([['nonce', 'changed'], ['crossorigin', 'use-credentials']]);
    if (as !== undefined) attributes.set('as', as);
    expect(options.applyHeaderAttributes(attributes, 'preload')).toBe(false);
    expect(options).toMatchObject({ nonce: '', crossorigin: 'no-cors', destination: '' });
  });

  it.each([
    ['', 'anonymous'], ['invalid', 'anonymous'], ['ANONYMOUS', 'anonymous'], ['Use-Credentials', 'use-credentials'],
  ])('uses the shared crossorigin interpretation for %s', (crossorigin, expected) => {
    const options = fixture();
    expect(options.applyHeaderAttributes(new Map([['crossorigin', crossorigin]]), 'preconnect')).toBe(true);
    expect(options.crossorigin).toBe(expected);
  });

  it('copies string metadata and only accepts recognized policy and priority values', () => {
    const options = fixture();
    options.applyHeaderAttributes(new Map([
      ['integrity', 'sha256-example'], ['nonce', 'Secret'], ['type', 'Text/CSS'],
      ['referrerpolicy', 'No-Referrer'], ['fetchpriority', 'HiGh'],
    ]), 'preconnect');
    expect(options).toMatchObject({
      integrity: 'sha256-example', nonce: 'Secret', type: 'Text/CSS', referrerPolicy: 'no-referrer', fetchPriority: 'high',
    });
    options.applyHeaderAttributes(new Map([['referrerpolicy', ' origin '], ['fetchpriority', 'invalid']]), 'preconnect');
    expect(options).toMatchObject({ referrerPolicy: 'no-referrer', fetchPriority: 'high' });
  });

  it('keeps resource operations explicit and leaves unrelated HTML header relations without effects', () => {
    const options = fixture();
    expect(() => options.processHeader('preload')).toThrow('Link preload fetching and Document commitment are not implemented');
    expect(() => options.processHeader('preconnect')).toThrow('Link preconnect is not implemented');
    expect(() => options.processHeader('modulepreload')).toThrow('Link modulepreload header integration is not implemented');
    for (const rel of ['unknown', 'stylesheet', 'dns-prefetch', 'prefetch']) {
      expect(() => options.processHeader(rel)).not.toThrow();
    }
  });
});

function fixture(): LinkProcessingOptions {
  const url = parseURL('https://destination.test/path/page').url!;
  return new LinkProcessingOptions(url, obtainURLOrigin(url), new PolicyContainer(), createManualUserAgent().sandbox);
}

function responseFixture() {
  const navigable = TopLevelTraversable.create(createManualUserAgent(), null, '');
  const params = navigable.createNavigationParamsFromSource(parseURL('https://document.test/path/page').url!);
  const document = navigable.createAndInitializeDocument('html', 'text/html', params);
  const response = new FetchResponse();
  response.urlList = [parseURL('https://response.test/elsewhere').url!];
  return { document, response };
}
