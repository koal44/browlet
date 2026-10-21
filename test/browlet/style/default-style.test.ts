import { describe, expect, it } from 'vitest';

import { TopLevelTraversable } from '../../../src/browlet/browsing/navigation/navigable';
import { UserAgent } from '../../../src/browlet/user-agent';
import { FetchResponse } from '../../../src/fetch/response';
import { parseURL } from '../../../src/url/index';

describe('CSSOM Default-Style response headers', () => {
  it.each([
    { headers: [], selected: 'alpha' },
    { headers: ['beta'], selected: 'beta' },
    { headers: ['alpha', 'beta'], selected: 'beta' },
    { headers: ['alpha,beta'], selected: 'alpha,beta' },
  ])('selects $selected from ordered fields $headers before sheets are added', ({ headers, selected }) => {
    const traversable = TopLevelTraversable.create(new UserAgent(), null, '');
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://example.test/styles').url!);
    for (const value of headers) response.headerList.append('dEfAuLt-StYlE', value);
    const document = traversable.createAndInitializeDocument(
      'html', 'text/html', traversable.createNavigationParams(response),
    );
    const root = document.createElement('html');
    document.appendChild(root);
    for (const title of ['alpha', 'beta', 'alpha,beta', 'Beta', '']) {
      const style = document.createElement('style');
      style.setAttribute('title', title);
      style.textContent = 'div { opacity: .5 }';
      root.appendChild(style);
    }
    expect([...document.styleSheets].map((sheet) => sheet.disabled))
      .toEqual(['alpha', 'beta', 'alpha,beta', 'Beta', ''].map((title) => title !== '' && title !== selected));
  });
});
