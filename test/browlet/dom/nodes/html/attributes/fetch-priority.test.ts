import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../../../src/browlet/browlet';
import { fetchPriorityAttribute } from '../../../../../../src/browlet/dom/nodes/html/attributes/fetch-priority';
import { FetchHeaders } from '../../../../../../src/fetch/headers';
import { FetchRequest } from '../../../../../../src/fetch/request';
import { mockHTTPTransport } from '../../../../../fetch/transport-fixture';
import { getRelevantRealm } from '../../../../../support/browlet-binding';
import { createFetchOperation } from '../../../../fetch-fixture';

describe('HTML fetch-priority attributes', () => {
  it.each(['high', 'low', 'auto'] as const)('recognizes %j and its ASCII case variants', (keyword) => {
    for (const value of [keyword, keyword.toUpperCase()]) {
      expect(fetchPriorityAttribute.getState(value)).toBe(keyword);
      expect(fetchPriorityAttribute.getCanonicalKeyword(keyword)).toBe(keyword);
      expect(fetchPriorityAttribute.isValidValue(value)).toBe(true);
    }
  });

  it('uses Auto for absent and invalid values without making invalid syntax conforming', () => {
    expect(fetchPriorityAttribute.getState(null)).toBe('auto');
    for (const value of ['', 'invalid', ' high ', '\tlow', 'high\n', 'high low', 'hıgh']) {
      expect(fetchPriorityAttribute.getState(value)).toBe('auto');
      expect(fetchPriorityAttribute.isValidValue(value)).toBe(false);
    }
  });

  // Exercise the request boundary directly; element loaders and transport scheduling are still missing.
  it.each([
    ['HIGH', 'high', 'image'], ['LOW', 'low', 'style'], [null, 'auto', 'script'],
  ] as const)('delivers the %j attribute state to Fetch priority selection', async (value, priority, destination) => {
    const browser = new Browlet({ route: () => '', reporting: false });
    await browser.navigate('https://priority.test/');
    const env = getRelevantRealm(browser.window).env;
    const request = new FetchRequest(env.parseURL('https://priority.test/resource')!, env);
    request.client = env;
    request.allowServiceWorkerInterception = false;
    request.destination = destination;
    request.priority = fetchPriorityAttribute.getState(value)!;
    const selectPriority = vi.spyOn(env.userAgent, 'determineFetchPriority');
    mockHTTPTransport(env.userAgent, (_wire, listener) => {
      listener.onHeaders(200, '', new FetchHeaders(), false);
      listener.onEnd();
    });
    const response = await createFetchOperation(request, env).start();
    expect(response.status).toBe(200);
    expect(selectPriority).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ priority, destination }));
  });
});
