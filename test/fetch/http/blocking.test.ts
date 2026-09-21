import { describe, expect, it } from 'vitest';
import {
  shouldBlockDueToBadPort, shouldBlockDueToMIMEType, shouldBlockDueToNosniff,
} from '../../../src/fetch/http/blocking';
import type { Destination } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL } from '../../../src/url/url';
import { createFetchRequest } from '../fetch-fixture';

describe('Fetch port blocking', () => {
  // Fetch §2.9's complete table, independent of the implementation's private set.
  it.each([
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
    101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
    389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
    636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
    6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
  ])('blocks HTTP and HTTPS port %i', (port) => {
    for (const scheme of ['http', 'https']) {
      expect(shouldBlockDueToBadPort(createFetchRequest(`${scheme}://example.test:${port}/`))).toBe('blocked');
    }
  });

  it.each([
    'http://example.test/', 'http://example.test:80/', 'https://example.test:443/',
    'http://example.test:2/', 'https://example.test:81/', 'https://example.test:65535/',
    'ftp://example.test:25/', 'ws://example.test:25/',
  ])('allows %s under the HTTP port rule', (url) => {
    expect(shouldBlockDueToBadPort(createFetchRequest(url))).toBe('allowed');
  });

  it('checks the current redirect URL rather than the original URL', () => {
    const request = createFetchRequest();
    request.urlList.push(parseURL('https://example.test:25/').url!);
    expect(shouldBlockDueToBadPort(request)).toBe('blocked');
    request.urlList.push(parseURL('https://example.test/').url!);
    expect(shouldBlockDueToBadPort(request)).toBe('allowed');
  });
});

describe('Fetch MIME type blocking', () => {
  it.each<Destination>([
    'audioworklet', 'paintworklet', 'script', 'serviceworker', 'sharedworker', 'worker',
  ])('blocks media and CSV for %s without requiring nosniff', (destination) => {
    const request = createFetchRequest();
    request.destination = destination;
    for (const mime of ['audio/ogg', 'image/png', 'video/mp4', 'TEXT/CSV;charset=utf-8']) {
      const response = new FetchResponse();
      response.headerList.list.push(['Content-Type', mime]);
      expect(shouldBlockDueToMIMEType(response, request)).toBe('blocked');
    }
  });

  it.each<Destination>(['', 'image', 'style', 'json', 'document'])(
    'does not apply the script-like rule to %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.list.push(['Content-Type', 'image/png']);

      expect(shouldBlockDueToMIMEType(response, request)).toBe('allowed');
    },
  );

  it.each([
    null, '', 'cannot-parse', '*/*', 'text/plain', 'text/html', 'text/javascript',
    'application/octet-stream', 'text/csvx', 'audiox/ogg',
  ])('allows %s through this particular MIME check', (mime) => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    if (mime !== null) response.headerList.list.push(['Content-Type', mime]);

    expect(shouldBlockDueToMIMEType(response, request)).toBe('allowed');
  });

  it('uses the last valid Content-Type rather than the first or an invalid trailing value', () => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    response.headerList.list.push(['Content-Type', 'image/png'], ['content-type', 'text/javascript']);
    expect(shouldBlockDueToMIMEType(response, request)).toBe('allowed');
    response.headerList.list.push(['Content-Type', 'audio/ogg, invalid']);
    expect(shouldBlockDueToMIMEType(response, request)).toBe('blocked');
  });
});

describe('Fetch nosniff blocking', () => {
  it.each<Destination>(['script', 'audioworklet', 'paintworklet', 'serviceworker', 'sharedworker', 'worker'])(
    'requires a JavaScript MIME type for %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.append('X-Content-Type-Options', 'nosniff');
      expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
      for (const type of ['TEXT/JAVASCRIPT;charset=utf-8', 'application/ecmascript', 'text/javascript1.5']) {
        response.headerList.set('Content-Type', type);
        expect(shouldBlockDueToNosniff(response, request)).toBe('allowed');
      }
      for (const type of ['text/plain', 'text/css', 'application/json', 'application/javascriptx', '*/*', 'invalid']) {
        response.headerList.set('Content-Type', type);
        expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
      }
    },
  );

  it('requires CSS for stylesheets and uses the last valid MIME type', () => {
    const request = createFetchRequest();
    request.destination = 'style';
    const response = new FetchResponse();
    response.headerList.append('X-Content-Type-Options', 'nosniff');
    expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
    response.headerList.append('Content-Type', 'text/plain');
    expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
    response.headerList.append('Content-Type', 'TEXT/CSS;charset=utf-8, invalid');
    expect(shouldBlockDueToNosniff(response, request)).toBe('allowed');
    response.headerList.append('Content-Type', 'text/javascript');
    expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
  });

  it.each<Destination>(['', 'image', 'font', 'audio', 'video', 'document', 'json'])(
    'does not apply this check to %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.append('X-Content-Type-Options', 'nosniff');
      expect(shouldBlockDueToNosniff(response, request)).toBe('allowed');
    },
  );

  it('leaves a script unblocked when nosniff is absent or not the first value', () => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    expect(shouldBlockDueToNosniff(response, request)).toBe('allowed');
    response.headerList.append('X-Content-Type-Options', 'invalid, nosniff');
    expect(shouldBlockDueToNosniff(response, request)).toBe('allowed');
    response.headerList.set('X-Content-Type-Options', 'NOSNIFF, invalid');
    expect(shouldBlockDueToNosniff(response, request)).toBe('blocked');
  });
});
