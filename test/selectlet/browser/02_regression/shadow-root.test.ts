import { runScenarios } from '../../dispatch';

runScenarios('shadow-root', 'normal', [
  {
    name: 'shadow-root/declarative-slot',
    // status: 'only',
    markup: `
      <div id="host">
        <span id="light" slot="x"></span>
        <template shadowrootmode="open">
          <slot name="x"></slot>
        </template>
      </div>
    `,
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/basic-query-context',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML =
          `<section><p id="inside" class="x"></p></section>`;
      });
    },
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: 'section .x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'shadow-root/closest-stays-inside-shadow-tree',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML =
          `<section id="section"><p id="inside"></p></section>`;
      });
    },
    cases: [
      { closest: 'section', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['section'] } },
      { closest: '#host', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { count: 0 } },
    ],
  },

  {
    name: 'shadow-root/slotted-light-dom-is-not-shadow-descendant',
    // status: 'only',
    markup: `<div id="host"><span id="light" slot="x"></span></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot name="x"></slot>`;
      });
    },
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/nested-shadow-context',
    // status: 'only',
    markup: `<div id="outer"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const outer = document.getElementById('outer')!;
        const outerRoot = outer.attachShadow({ mode: 'open' });
        outerRoot.innerHTML = `<div id="inner-host"></div>`;
        outerRoot.getElementById('inner-host')!.attachShadow({ mode: 'open' }).innerHTML =
          `<p id="deep" class="x"></p>`;
      });
    },
    cases: [
      { select: '#deep', expect: { count: 0 } },
      { select: '#deep', ref: { by: 'shadowRoot', id: 'outer' }, expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'inner-host', within: { by: 'shadowRoot', id: 'outer' } }, expect: { ids: ['deep'] } },
    ],
  },

  {
    name: 'shadow-root/declarative-basic',
    // status: 'only',
    markup: `
      <div id="host">
        <template shadowrootmode="open">
          <p id="inside" class="x"></p>
        </template>
      </div>
    `,
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'shadow-root/slotted-pseudo-element-valid-and-malformed-empty',
    // status: 'only',
    markup: `<div id="host"><foo id="light" slot="x"></foo></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML =
          `<slot name="x"></slot>`;
      });
    },
    cases: [
      { select: '::slotted(foo)', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: '::slotted(foo', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
    ],
  },

  {
    name: 'shadow-root/featureless-host-boundary-logical-pseudos',
    // status: 'only',
    // engines: ['native'],
    // Chromium/Firefox agree here; WebKit currently diverges on host-boundary :not(:host(...)) behavior.
    browsers: ['chromium', 'firefox'],
    markup: `
      <main id="outer" class="theme">
        <div id="host" class="foo"></div>
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <div id="inside" class="a">
            <span id="deep" class="b"></span>
          </div>
          <div id="insideFoo" class="a foo">
            <span id="deepFoo" class="foo"></span>
          </div>
          <div id="plain">
            <span id="plainChild"></span>
          </div>
        `;
      });
    },
    cases: [
      // Baseline host boundary behavior.
      { select: ':host *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain', 'plainChild'] } },
      { select: ':host > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host(.foo) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host(.missing) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Host-context is also a host-boundary selector, but its condition is external.
      { select: ':host-context(.theme) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] }, browsers: ['chromium'] },
      { select: ':host-context(.theme) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['firefox'], engines: ['native'] },
      { select: ':host-context(.missing) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] }, browsers: ['chromium'] },
      { select: ':host-context(.missing) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { throws: true }, browsers: ['firefox'], engines: ['native'] },

      // Ordinary simple selectors beside :host do not become host arguments.
      { select: '.foo:host *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host.foo *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '#host:host *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: 'div:host *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // :not() does not rescue an argument that is disallowed for the featureless host.
      { select: ':host:not(.foo:host) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host:not(.missing:host) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host:not(:host.foo) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // :not(:host(ARG)) is different: the argument is an allowed host-boundary question.
      { select: ':host:not(:host(.missing)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host:not(:host(.foo)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host(.foo):not(:host(.missing)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host(.foo):not(:host(.foo)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // No explicit :host outside: this must produce both ordinary and host-boundary behavior.
      { select: ':not(:host(.missing)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain', 'plainChild'] } },
      { select: ':not(:host(.foo)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },
      { select: ':not(.foo:host) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },
      { select: ':not(.missing:host) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },

      // Descendant combinator version of the same split.
      { select: ':not(:host(.missing)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain', 'plainChild'] } },
      { select: ':not(:host(.foo)) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },

      // :is() / :where() host projection.
      { select: ':is(:host(.foo), .a) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain'] } },
      { select: ':is(:host(.missing), .a) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo'] } },
      { select: ':where(:host(.foo), .a) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain'] } },
      { select: ':where(:host(.missing), .a) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo'] } },

      // :host combined with :is() / :where() should remain host-boundary capable.
      { select: ':host:is(:host(.foo)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host:is(:host(.missing)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host:where(:host(.foo)):not(:host(.missing)) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] } },
      { select: ':host:where(:host(.foo)):not(.missing:host) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Nested logical pseudo cases. These are good pressure tests for whether lifting is too shallow.
      { select: ':not(:is(:host(.missing))) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain', 'plainChild'] } },
      { select: ':not(:is(:host(.foo))) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },
      { select: ':not(:where(:host(.missing))) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'deep', 'insideFoo', 'deepFoo', 'plain', 'plainChild'] } },
      { select: ':not(:where(:host(.foo))) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'deepFoo', 'plainChild'] } },

      { select: ':has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'insideFoo', 'plain'] }, browsers: ['chromium'], engines: ['native'] },
      { select: ':has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep'] }, browsers: ['firefox'] },
      { select: ':host:has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside', 'insideFoo', 'plain'] }, browsers: ['chromium'], engines: ['native'] },
      { select: ':host:has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] }, browsers: ['firefox'] },
      { select: ':host:has(.missing) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':not(:host(.missing)):has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep', 'insideFoo', 'plain'] }, browsers: ['chromium'], engines: ['native'] },
      { select: ':not(:host(.missing)):has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep'] }, browsers: ['firefox'] },
      { select: ':not(:host(.foo)):has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['deep'] } },
      { select: ':host:not(.foo:host):has(.b) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
    ],
  },

  {
    name: 'shadow-root/host-boundary-then-singleton-advance',
    // status: 'only',
    browsers: ['chromium', 'firefox'],
    markup: `
      <main id="outer">
        <div id="host" class="foo"></div>
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `
          <section id="a" class="foo">
            <div id="bar" class="bar"></div>
            <div id="baz" class="baz"></div>
          </section>
          <section id="c">
            <div id="cBar" class="bar"></div>
            <div id="cBaz" class="baz"></div>
          </section>
          <div id="looseBar" class="bar"></div>
        `;
      });
    },
    cases: [
      { select: ':host > .foo', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['a'] }, debug: false },
      { select: ':host > .foo > .bar', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['bar'] }, debug: false },
      { select: ':host > .foo > .bar + .baz', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['baz'] }, debug: false },
      { select: ':host .foo > .bar + .baz', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['baz'] }, debug: false },
    ],
  },

]);
