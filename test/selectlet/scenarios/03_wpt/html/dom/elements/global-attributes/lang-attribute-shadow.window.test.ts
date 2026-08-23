import { runScenarios } from '../../../../../../../scenario/dispatch';

runScenarios('lang pseudo', 'normal', [
  {
    name: 'wpt lang shadow only on slot',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" data-expected="en-US"><span id="light" data-expected="en-US"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot" lang="en-AU" data-expected="en-AU"></slot>`;
      });
    },
    cases: [
      { match: ':lang(en-US)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-US)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] } },
      { match: ':lang(en-US)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt lang shadow only on host',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" lang="en-AU" data-expected="en-AU"><span id="light" data-expected="en-AU"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot" data-expected="en-AU"></slot>`;
      });
    },
    cases: [
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-US)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] }, browsers: ['chromium', 'webkit'] },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] }, browsers: ['firefox'], engines: ['native'] },
      { match: ':lang(en-US)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt lang shadow on host and slot',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" lang="en-AU" data-expected="en-AU"><span id="light" data-expected="en-AU"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot" lang="en-GB" data-expected="en-GB"></slot>`;
      });
    },
    cases: [
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt lang shadow on host and slotted element',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" lang="en-AU" data-expected="en-AU"><span id="light" lang="en-GB" data-expected="en-GB"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot" data-expected="en-AU"></slot>`;
      });
    },
    cases: [
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] }, browsers: ['chromium', 'webkit'] },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] }, browsers: ['firefox'], engines: ['native'] },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt lang shadow on host slot and slotted element',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" lang="en-AU" data-expected="en-AU"><span id="light" lang="en-GB" data-expected="en-GB"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot" lang="en-NZ" data-expected="en-NZ"></slot>`;
      });
    },
    cases: [
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-NZ)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-NZ)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] } },
      { match: ':lang(en-AU)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },

  {
    name: 'wpt lang shadow slot inherits from parent',
    // status: 'only',
    markup: `
      <div id="container" lang="en-US">
        <div id="host" lang="en-GB" data-expected="en-GB"><span id="light" lang="en-US" data-expected="en-US"></span></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="shadow-parent" lang="en-CA" data-expected="en-CA">
            <slot id="slot" data-expected="en-CA"></slot>
          </div>
        `;
      });
    },
    cases: [
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'host' }, expect: { ids: ['host'] } },
      { match: ':lang(en-US)', ref: { by: 'id', id: 'light' }, expect: { ids: ['light'] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'light' }, expect: { ids: [] } },
      { match: ':lang(en-CA)', ref: { by: 'id', id: 'shadow-parent', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['shadow-parent'] } },
      { match: ':lang(en-CA)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['slot'] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'shadow-parent', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
      { match: ':lang(en-GB)', ref: { by: 'id', id: 'slot', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },
    ],
  },
]);
