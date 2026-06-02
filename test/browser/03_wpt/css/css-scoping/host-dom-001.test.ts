import { runScenarios } from '../../../../dispatch';

runScenarios('host pseudo', 'normal', [
  {
    name: 'wpt host pseudo in dom apis',
    status: 'fixme',
    // engines: ['native'],
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<div id="inside"></div>`;
      });
    },
    cases: [
      { match: ':host', ref: { by: 'id', id: 'host' }, expect: { ids: [] } },
      { match: ':host div', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inside'] } },
      { select: ':host div', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },
]);
