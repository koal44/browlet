import { runScenarios } from '../../../../dispatch';

runScenarios('css/css-scoping/host-context-parsing', 'normal', [
  {
    name: ':host-context() pseudo-class selectors parse',
    // status: 'only',
    // engines: ['native'],
    browsers: ['chromium'],
    markup: `<div id="target"></div>`,
    cases: [
      { match: ':host-context(.a)', ref: { by: 'id', id: 'target' }, expect: { throws: false } },
      { match: ':host-context(div.a)', ref: { by: 'id', id: 'target' }, expect: { throws: false } },

      { match: ':host-context', ref: { by: 'id', id: 'target' }, expect: { throws: true } },
      { match: ':host-context()', ref: { by: 'id', id: 'target' }, expect: { throws: true } },
      { match: ':host-context(.a, .b)', ref: { by: 'id', id: 'target' }, expect: { throws: true } },
      { match: ':host-context(.a + .b)', ref: { by: 'id', id: 'target' }, expect: { throws: true } },
      { match: ':host-context(.a + .b, #c > #d)', ref: { by: 'id', id: 'target' }, expect: { throws: true } },
    ],
  },

  {
    name: 'native host-context pseudo boundary probes',
    // status: 'only',
    // engines: ['native'],
    browsers: ['chromium'],
    markup: `
    <main id="outer">
      <section id="bar" class="theme">
        <div id="host"></div>
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
      { select: ':host-context(.theme) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(#host) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(.missing) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      { select: ':host-context(.theme) > *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article', 'top'] } },
      { match: ':host-context(.theme) > #article', ref: { by: 'id', id: 'article', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['article'] } },
      { match: ':host-context(.theme) > #inside', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: [] } },

      { select: ':host-context(.theme)', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '* :host-context(.theme) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // From WPT: :host-context(:host) should not match.
      { select: ':host-context(:host) *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Multiple independent context predicates.
      { select: ':host-context(.theme):host-context(#bar) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(.theme):host-context(.missing) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Alternatives must go through :is().
      { select: ':host-context(:is(.theme, .missing)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Repeated virtual boundary with a combinator should die.
      { select: ':host-context(.theme) :host-context(#bar) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host-context(#outer) :host-context(#bar) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Host-context can match host itself, immediate outer parent, or farther ancestor.
      { select: ':host-context(#host) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(#bar) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(#outer) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Same-compound context predicates are independent existential checks.
      { select: ':host-context(#outer):host-context(#bar) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(#outer):host-context(.theme) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // But they do not require the same ancestor to match both pieces.
      // #outer is not .theme; #bar is .theme but not #outer.
      { select: ':host-context(#outer.theme) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Direct child boundary works, but only for top-level shadow children.
      { select: ':host-context(.theme) > #article', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['article'] } },
      { select: ':host-context(.theme) > #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Sibling boundaries from the virtual host-context boundary are impossible.
      { select: ':host-context(.theme) + *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host-context(.theme) ~ *', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Prefix before host-context should poison the host-context arm.
      { select: '#article :host-context(.theme) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // :is() inside :host-context() can express alternatives.
      { select: ':host-context(:is(#outer, .missing)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // :is() inside :host-context() can contain complex selectors;
      // the matched context element is #bar, which is #outer > #bar.
      { select: ':host-context(:is(#outer > #bar)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Negative mirror for the complex :is() context case.
      { select: ':host-context(:is(#outer > #host)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      // Lifting/merge challenge: surrounding tag must merge onto #article, not onto the virtual boundary/host.
      { select: 'article:is(:host-context(.theme) #article) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },

      // Negative mirror: host is a div, but #article is not. If div merges onto the virtual boundary,
      // this could incorrectly match.
      { select: 'div:is(:host-context(.theme) #article) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },

      { select: ':host-context(:is(#outer, .missing)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: ':host-context(:is(#outer > #bar)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host-context(:is(.missing, #outer > #bar)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: ':host-context(:is(.theme, #outer > #bar)) #inside', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

]);
