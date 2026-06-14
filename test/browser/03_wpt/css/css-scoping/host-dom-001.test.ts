import { runScenarios } from '../../../../dispatch';

runScenarios('host pseudo', 'normal', [
  {
    name: 'wpt host pseudo in dom apis',
    // status: 'only',
    engines: ['native'],
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
      { select: ':host', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'native host pseudo boundary probes',
    // status: 'only',
    engines: ['native'],
    markup: `<section id="bar"><div id="host" class="foo"></div></section>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <article id="article">
            <div id="inside"></div>
          </article>
          <div id="top"></div>
        `;
      });
    },
    cases: [
      { select: ':host', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article', 'top'] } },
      { match: ':host > #article', ref: { by: 'id', id: 'article', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['article'] } },
      { match: ':host > #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
      { match: ':host #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inside'] } },

      { match: ':host(.foo) #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['inside'] } },
      { match: ':host.foo #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
      { match: '.foo:host #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },

      { match: '#bar > :host(.foo) #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
      { select: '* :host(.foo) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '* ~ :host(.foo) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host(.foo) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article', 'inside', 'top'] } },

      { select: ':host(.foo) + *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host(.foo) ~ *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'native host pseudo in is where probes',
    // status: 'only',
    engines: ['native'],
    markup: `<section id="bar"><div id="host" class="foo"></div></section>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="outer">
            <article id="article">
              <div id="inside"></div>
            </article>
          </div>
          <div id="top"></div>
        `;
      });
    },
    cases: [
      { select: ':is(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['outer', 'article', 'inside', 'top'] } },
      { select: ':where(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['outer', 'article', 'inside', 'top'] } },

      { select: '* :is(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '* :where(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      { select: '* :is(:host(.foo), #article) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: '* :where(:host(.foo), #article) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

]);
