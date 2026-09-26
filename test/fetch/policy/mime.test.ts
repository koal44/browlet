import { describe, expect, it } from 'vitest';

import { isBlockedByMIMEType, isBlockedByNosniff } from '../../../src/fetch/policy';
import type { Destination } from '../../../src/fetch/request';
import { FetchResponse } from '../../../src/fetch/response';
import { createFetchRequest } from '../fetch-fixture';

describe('Fetch MIME type blocking', () => {
  it.each([
    null, '', 'cannot-parse', '*/*', 'text/plain', 'text/html', 'text/javascript',
    'application/octet-stream', 'text/csvx', 'audiox/ogg',
  ])('allows %s through this particular MIME check', (mime) => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    if (mime !== null) response.headerList.list.push(['Content-Type', mime]);

    expect(isBlockedByMIMEType(response, request)).toBe(false);
  });

  it.each<Destination>([
    'audioworklet', 'paintworklet', 'script', 'serviceworker', 'sharedworker', 'worker',
  ])('blocks media and CSV for %s without requiring nosniff', (destination) => {
    const request = createFetchRequest();
    request.destination = destination;
    for (const mime of ['audio/ogg', 'image/png', 'video/mp4', 'TEXT/CSV;charset=utf-8']) {
      const response = new FetchResponse();
      response.headerList.list.push(['Content-Type', mime]);
      expect(isBlockedByMIMEType(response, request)).toBe(true);
    }
  });

  it.each<Destination>(['', 'image', 'style', 'json', 'document'])(
    'does not apply the script-like rule to %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.list.push(['Content-Type', 'image/png']);

      expect(isBlockedByMIMEType(response, request)).toBe(false);
    },
  );

  it('uses the last valid Content-Type rather than the first or an invalid trailing value', () => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    response.headerList.list.push(['Content-Type', 'image/png'], ['content-type', 'text/javascript']);
    expect(isBlockedByMIMEType(response, request)).toBe(false);
    response.headerList.list.push(['Content-Type', 'audio/ogg, invalid']);
    expect(isBlockedByMIMEType(response, request)).toBe(true);
  });
});

describe('Fetch nosniff blocking', () => {
  it('leaves a script unblocked when nosniff is absent or not the first value', () => {
    const request = createFetchRequest();
    request.destination = 'script';
    const response = new FetchResponse();
    expect(isBlockedByNosniff(response, request)).toBe(false);
    response.headerList.append('X-Content-Type-Options', 'invalid, nosniff');
    expect(isBlockedByNosniff(response, request)).toBe(false);
    response.headerList.set('X-Content-Type-Options', 'NOSNIFF, invalid');
    expect(isBlockedByNosniff(response, request)).toBe(true);
  });

  it.each<Destination>(['script', 'audioworklet', 'paintworklet', 'serviceworker', 'sharedworker', 'worker'])(
    'requires a JavaScript MIME type for %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.append('X-Content-Type-Options', 'nosniff');
      expect(isBlockedByNosniff(response, request)).toBe(true);
      for (const type of ['TEXT/JAVASCRIPT;charset=utf-8', 'application/ecmascript', 'text/javascript1.5']) {
        response.headerList.set('Content-Type', type);
        expect(isBlockedByNosniff(response, request)).toBe(false);
      }
      for (const type of ['text/plain', 'text/css', 'application/json', 'application/javascriptx', '*/*', 'invalid']) {
        response.headerList.set('Content-Type', type);
        expect(isBlockedByNosniff(response, request)).toBe(true);
      }
    },
  );

  it('requires CSS for stylesheets and uses the last valid MIME type', () => {
    const request = createFetchRequest();
    request.destination = 'style';
    const response = new FetchResponse();
    response.headerList.append('X-Content-Type-Options', 'nosniff');
    expect(isBlockedByNosniff(response, request)).toBe(true);
    response.headerList.append('Content-Type', 'text/plain');
    expect(isBlockedByNosniff(response, request)).toBe(true);
    response.headerList.append('Content-Type', 'TEXT/CSS;charset=utf-8, invalid');
    expect(isBlockedByNosniff(response, request)).toBe(false);
    response.headerList.append('Content-Type', 'text/javascript');
    expect(isBlockedByNosniff(response, request)).toBe(true);
  });

  it.each<Destination>(['', 'image', 'font', 'audio', 'video', 'document', 'json'])(
    'does not apply this check to %s', (destination) => {
      const request = createFetchRequest();
      request.destination = destination;
      const response = new FetchResponse();
      response.headerList.append('X-Content-Type-Options', 'nosniff');
      expect(isBlockedByNosniff(response, request)).toBe(false);
    },
  );
});
