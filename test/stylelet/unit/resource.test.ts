import { createStyleletTestEnvironment } from '../environment-fixture';
import { expect, it, vi } from 'vitest';

import { CSSStyleDeclarationImpl, fetchStyleResource, UrlValue } from '../../../src/stylelet/index';
import type { FetchResponse } from '../../../src/fetch/index';

it('fetches a CSS resource through a standalone host with its own bindings and task delivery', async () => {
  const env = createStyleletTestEnvironment();
  // The Fetch fixture trusts HTTPS/WSS only; this host also permits its data: resource.
  env.userAgent.isURLPotentiallyTrustworthy = (url) => ['https', 'wss', 'data'].includes(url.scheme);
  const tasks = vi.spyOn(env.exec, 'queueGlobalFetchTask');
  const declaration = new CSSStyleDeclarationImpl({}, env);
  const url = UrlValue.fromString('url', 'data:text/plain,standalone', {});
  const result = await new Promise<{ response: FetchResponse; body: Uint8Array | null | 'failure'; }>((resolve) => {
    expect(fetchStyleResource(url, declaration, 'style', 'no-cors', env, (response, body) => {
      resolve({ response, body });
    })).not.toBeNull();
  });

  expect(result.response.status).toBe(200);
  expect(result.body).toEqual(new TextEncoder().encode('standalone'));
  expect(tasks).toHaveBeenCalledWith(env.exec.global, expect.any(Function));
  tasks.mockRestore();
});
