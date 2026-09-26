import { describe, expect, it } from 'vitest';

import { isBlockedByBadPort } from '../../../src/fetch/policy';
import { parseURL } from '../../../src/url/url';
import { createFetchRequest } from '../fetch-fixture';

describe('Fetch port blocking', () => {
  it.each([
    'http://example.test/', 'http://example.test:80/', 'https://example.test:443/',
    'http://example.test:2/', 'https://example.test:81/', 'https://example.test:65535/',
    'ftp://example.test:25/', 'ws://example.test:25/',
  ])('allows %s under the HTTP port rule', (url) => {
    expect(isBlockedByBadPort(createFetchRequest(url))).toBe(false);
  });

  // Fetch §2.9's complete table, independent of the implementation's private set.
  it.each([
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
    101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
    389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
    636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
    6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
  ])('blocks HTTP and HTTPS port %i', (port) => {
    for (const scheme of ['http', 'https']) {
      expect(isBlockedByBadPort(createFetchRequest(`${scheme}://example.test:${port}/`))).toBe(true);
    }
  });

  it('checks the current redirect URL rather than the original URL', () => {
    const request = createFetchRequest();
    request.urlList.push(parseURL('https://example.test:25/').url!);
    expect(isBlockedByBadPort(request)).toBe(true);
    request.urlList.push(parseURL('https://example.test/').url!);
    expect(isBlockedByBadPort(request)).toBe(false);
  });
});
