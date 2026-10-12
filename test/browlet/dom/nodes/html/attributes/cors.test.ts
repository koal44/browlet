import { describe, expect, it } from 'vitest';

import { corsSettingsAttribute, getCORSSettingsCredentialsMode } from '../../../../../../src/browlet/dom/nodes/html/attributes/cors';
import { UserAgent } from '../../../../../../src/browlet/user-agent';
import { parseURL } from '../../../../../../src/url/url';

describe('HTML CORS settings attributes', () => {
  it.each([
    [null, 'no-cors', null],
    ['', 'anonymous', 'anonymous'],
    ['anonymous', 'anonymous', 'anonymous'],
    ['ANONYMOUS', 'anonymous', 'anonymous'],
    ['use-credentials', 'use-credentials', 'use-credentials'],
    ['USE-CREDENTIALS', 'use-credentials', 'use-credentials'],
    ['invalid', 'anonymous', 'anonymous'],
    [' use-credentials ', 'anonymous', 'anonymous'],
    ['use-credentialſ', 'anonymous', 'anonymous'],
  ] as const)('interprets %j as %s', (value, state, keyword) => {
    expect(corsSettingsAttribute.getState(value)).toBe(state);
    expect(corsSettingsAttribute.getCanonicalKeyword(state)).toBe(keyword);
  });

  it.each([
    ['no-cors', 'same-origin'],
    ['anonymous', 'same-origin'],
    ['use-credentials', 'include'],
  ] as const)('maps the %s state for always-CORS fetches to %s', (state, credentials) => {
    expect(getCORSSettingsCredentialsMode(state)).toBe(credentials);
  });

  it.each([
    [null, 'no-cors', 'include'],
    ['', 'cors', 'same-origin'],
    ['invalid', 'cors', 'same-origin'],
    ['USE-CREDENTIALS', 'cors', 'include'],
  ] as const)('supplies the interpreted %j attribute to potential-CORS request creation', (value, mode, credentials) => {
    const userAgent = new UserAgent();
    const state = corsSettingsAttribute.getState(value)!;
    const request = userAgent.createPotentialCORSRequest(parseURL('https://example.test/script.js').url!, 'script', state);
    expect(request.mode).toBe(mode);
    expect(request.credentialsMode).toBe(credentials);
  });
});
