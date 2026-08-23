import { runScenarios } from '../../../../../scenario/dispatch';

runScenarios('host pseudo', 'normal', [
  {
    name: 'wpt host pseudo in dom apis',
    // status: 'only',
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
      { select: ':host', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'native host pseudo boundary probes',
    // status: 'only',
    // engines: ['native'],
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
    // engines: ['native'],
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

  {
    name: 'native host pseudo complex is where expansion probes',
    // status: 'only',
    // engines: ['native'],
    markup: `<section id="bar"><div id="host" class="foo"></div></section>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="outer">
            <article id="article" class="bar">
              <div id="inside"></div>
            </article>
          </div>
          <div id="top"></div>
        `;
      });
    },
    cases: [
      // Seed lookup below an Element root inside a ShadowRoot.
      { select: '#outer #article *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: '#outer article *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: '#outer .bar *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Complex argument arm inside :is/:where.
      { select: ':is(:host(.foo) > #outer) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article', 'inside'] } },
      { select: ':where(:host(.foo) > #outer) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article', 'inside'] } },

      // Direct-child host arm is impossible here because #article is nested under #outer;
      { select: ':is(:host(.foo) > #article, #top) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':where(:host(.foo) > #article, #top) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Descendant host arm contributes through #article; #top still contributes nothing.
      { select: ':is(:host(.foo) #article, #top) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':where(:host(.foo) #article, #top) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // The outer compound must merge onto the argument subject (#article), not onto :host.
      { select: '.bar:is(:host(.foo) #article) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Negative mirror: host has .foo, but #article does not.
      { select: '.foo:is(:host(.foo) #article) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Attribute/test context should also merge onto the argument subject.
      { select: '[class~="bar"]:is(:host(.foo) #article) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Nested fixed-point expansion.
      { select: ':is(:where(:host(.foo), #article), #top) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['outer', 'article', 'inside', 'top'] } },

      // Prefix arm poison: host arm dies under #outer prefix, #article arm survives.
      { select: '#outer :is(:host(.foo), #article) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Host through :is() still supports child boundary.
      { select: ':is(:host(.foo)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['outer', 'top'] } },
      { match: ':is(:host(.foo)) > #outer', ref: { by: 'id', id: 'outer', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['outer'] } },

      // Host sibling boundaries are impossible after expansion.
      { select: ':is(:host(.foo)) + *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':is(:host(.foo)) ~ *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Repeated virtual host boundary should not become a real descendant chain.
      { select: ':host(.foo) :host(.foo) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':is(:host(.foo)) :is(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'native host pseudo is argument restrictions',
    // status: 'only',
    markup: `
      <main id="outer">
        <section id="bar" class="theme">
          <div id="host" class="foo"></div>
        </section>
      </main>
    `,
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
      // Simple :is() arms inside :host() are allowed everywhere.
      { select: ':host(:is(.foo, .missing)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // #bar > #host is true for the host in the light DOM.
      // Chromium/Firefox/selectlet reject that complex arm inside :host(:is()).
      { select: ':host(:is(#bar > #host)) #inside', browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      // WebKit native currently allows the complex arm through.
      { select: ':host(:is(#bar > #host)) #inside', browsers: ['webkit'], engines: ['native'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Complex arm should not save the selector when the simple arm misses.
      { select: ':host(:is(.missing, #bar > #host)) #inside', browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      // WebKit native lets the complex arm save it.
      { select: ':host(:is(.missing, #bar > #host)) #inside', browsers: ['webkit'], engines: ['native'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // A valid simple arm survives beside the rejected complex arm.
      { select: ':host(:is(.foo, #bar > #host)) #inside', browsers: ['chromium', 'firefox'], engines: ['native', 'selectlet'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      // WebKit also matches, but for a more permissive reason.
      { select: ':host(:is(.foo, #bar > #host)) #inside', browsers: ['webkit'], engines: ['native'], ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

]);
