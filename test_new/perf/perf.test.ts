import { readFileSync } from 'node:fs';
import { runPerfScenarios } from './harness/perf-scenario';

const htmlStandard = readFileSync('test_new/browser/fixtures/slick/template-standard.html', 'utf8');

runPerfScenarios('perf', [
  {
    name: 'blob mixed overview',
    // status: 'only',
    status: 'skip',
    browsers: ['chromium'],
    markup: htmlStandard,
    probeKeys: ['select', 'selBuild', 'match', 'matBuild'],
    benches: [
      { label: 'select div',                op: 'select', selector: 'div',                    context: null, iters: 200 },
      { label: 'select .comment',           op: 'select', selector: '.comment',               context: null, iters: 200 },
      { label: 'select [data-testid]',      op: 'select', selector: '[data-testid]',          context: null, iters: 200 },
      { label: 'select a[href*="commits"]', op: 'select', selector: 'a[href*="commits"]',     context: null, iters: 200 },
      { label: 'select textarea',           op: 'select', selector: 'textarea',               context: null, iters: 200 },
      { label: 'select button',             op: 'select', selector: 'button',                 context: null, iters: 200 },
      { label: 'select [popover]',          op: 'select', selector: '[popover]',              context: null, iters: 200 },
      { label: 'select :not(button)',       op: 'select', selector: ':not(button)',           context: null, iters: 200 },
      { label: 'select :is(div, span, a)',  op: 'select', selector: ':is(div, span, a)',      context: null, iters: 200 },

      { label: 'first div',                 op: 'first', selector: 'div',                    context: null, iters: 500 },
      { label: 'first .comment',            op: 'first', selector: '.comment',               context: null, iters: 500 },
      { label: 'first [data-testid]',       op: 'first', selector: '[data-testid]',          context: null, iters: 500 },
      { label: 'first a[href*="commits"]',  op: 'first', selector: 'a[href*="commits"]',     context: null, iters: 500 },
      { label: 'first textarea',            op: 'first', selector: 'textarea',               context: null, iters: 500 },
      { label: 'first button',              op: 'first', selector: 'button',                 context: null, iters: 500 },
      { label: 'first [popover]',           op: 'first', selector: '[popover]',              context: null, iters: 500 },
      { label: 'first :not(button)',        op: 'first', selector: ':not(button)',           context: null, iters: 500 },
      { label: 'first :is(div, span, a)',   op: 'first', selector: ':is(div, span, a)',      context: null, iters: 500 },

      { label: 'match walk remove group',   op: 'matchWalk', context: null, selectors: ['button', '[popover]', '[data-testid="author-avatar"]'], iters: 20 },
      { label: 'match walk replace group',  op: 'matchWalk', context: null, selectors: ['textarea', 'div', 'p'], iters: 20 },
      { label: 'match walk links group',    op: 'matchWalk', context: null, selectors: ['a[href*="commits"]', '[class*="codeBlobInner"] textarea'], iters: 20 },
      { label: 'match walk code group',     op: 'matchWalk', context: null, selectors: ['pre', 'code', '.highlight'], iters: 20 },
      { label: 'walk only',                 op: 'matchWalk', context: null, selectors: [], iters: 50 },
    ],
  },

  {
    name: 'match universal',
    // status: 'only',
    browsers: ['chromium'],
    markup: `<div id="hit"></div>`,
    probeKeys: ['match'],
    quickIters: 200_000,
    benches: [
      { label: 'match universal hit', op: 'match', selector: '*', context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match id',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button id="miss"></button>
      <span id="search-icon"></span>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'match id hit',  op: 'match', selector: '#search-icon', context: 'search-icon', iters: 5_000_000 },
      { label: 'match id miss', op: 'match', selector: '#search-icon', context: 'miss',        iters: 5_000_000 },
    ],
  },

  {
    name: 'match class',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button id="miss"></button>
      <span id="hit" class="octicon"></span>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'match class hit',  op: 'match', selector: '.octicon', context: 'hit',  iters: 5_000_000 },
      { label: 'match class miss', op: 'match', selector: '.octicon', context: 'miss', iters: 5_000_000 },
    ],
  },

  {
    name: 'match tag',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="div"></div>
      <button id="button"></button>
      <textarea id="textarea"></textarea>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'match tag div hit',     op: 'match', selector: 'div',      context: 'div',      iters: 5_000_000 },
      { label: 'match tag div miss',    op: 'match', selector: 'div',      context: 'button',   iters: 5_000_000 },
      { label: 'match tag button hit',  op: 'match', selector: 'button',   context: 'button',   iters: 5_000_000 },
      { label: 'match tag textarea hit',op: 'match', selector: 'textarea', context: 'textarea', iters: 5_000_000 },
    ],
  },

  {
    name: 'match namespace',
    // status: 'only',
    browsers: ['chromium'],
    markupMode: 'xml-document',
    engines: ['native'],
    markup: `
      <root xmlns:ns="http://example.test/ns">
        <foo id="null-foo"></foo>
        <ns:foo id="ns-foo"></ns:foo>
        <bar id="null-bar"></bar>
      </root>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'match namespace any hit null', op: 'match', selector: '*|foo', context: 'null-foo', iters: 5_000_000 },
      { label: 'match namespace any hit ns',   op: 'match', selector: '*|foo', context: 'ns-foo',   iters: 5_000_000 },
      { label: 'match namespace null hit',     op: 'match', selector: '|foo',  context: 'null-foo', iters: 5_000_000 },
      { label: 'match namespace null miss ns', op: 'match', selector: '|foo',  context: 'ns-foo',   iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-testid="author-avatar"
        data-kind="primary-action"
        data-tags="foo octicon bar"
        data-path="/repos/example/commits/abc"
        data-prefix="commit-start"
        data-suffix="end-commit"
        lang="en-US"
        type="BUTTON"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exists',       op: 'match', selector: '[data-testid]',                  context: 'hit', iters: 5_000_000 },
      { label: 'exact',        op: 'match', selector: '[data-testid="author-avatar"]',  context: 'hit', iters: 5_000_000 },
      { label: 'contains',     op: 'match', selector: '[data-path*="commits"]',         context: 'hit', iters: 5_000_000 },
      { label: 'token',        op: 'match', selector: '[data-tags~="octicon"]',         context: 'hit', iters: 5_000_000 },
      { label: 'prefix',       op: 'match', selector: '[data-prefix^="commit"]',        context: 'hit', iters: 5_000_000 },
      { label: 'suffix',       op: 'match', selector: '[data-suffix$="commit"]',        context: 'hit', iters: 5_000_000 },
      { label: 'ns dash',      op: 'match', selector: '[lang|="en"]',                   context: 'hit', iters: 5_000_000 },
      { label: 'star dash',    op: 'match', selector: '[*|lang|="en"]',                 context: 'hit', iters: 5_000_000, maxRatio: 18 },
      { label: 'flag i',       op: 'match', selector: '[data-kind="PRIMARY-ACTION" i]', context: 'hit', iters: 5_000_000 },
      { label: 'html default', op: 'match', selector: '[type="button"]',                context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute existence',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-testid="author-avatar"
        data-kind="primary-action"
        data-tags="foo octicon bar"
        data-path="/repos/example/commits/abc"
        data-prefix="commit-start"
        data-suffix="end-commit"
        lang="en-US"
        type="BUTTON"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exists hit',  op: 'match', selector: '[data-testid]', context: 'hit', iters: 5_000_000 },
      { label: 'exists miss', op: 'match', selector: '[data-missing]', context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute existence namespace paths',
    // status: 'only',
    browsers: ['chromium'],
    // browsers: ['firefox'],
    markup: `
      <div id="html-hit" title="x" foo:bar="x"></div>
      <div id="html-miss" data-x="x"></div>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'wildcard html hit', op: 'match', selector: '[*|TiTlE]', context: 'html-hit', iters: 5_000_000, maxRatio: 6 },
      { label: 'wildcard html miss', op: 'match', selector: '[*|missing]', context: 'html-hit', iters: 5_000_000, maxRatio: 6 },
      { label: 'colon html hit', op: 'match', selector: '[foo\\:bar]', context: 'html-hit', iters: 5_000_000, maxRatio: 6 },
      { label: 'colon html miss', op: 'match', selector: '[bar\\:foo]', context: 'html-hit', iters: 5_000_000, maxRatio: 6 },
    ],
  },

  {
    name: 'match attribute value operators',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-testid="author-avatar"
        data-tags="foo octicon bar"
        data-path="/repos/example/commits/abc"
        data-prefix="commit-start"
        data-suffix="end-commit"
        lang="en-US"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exact hit',    op: 'match', selector: '[data-testid="author-avatar"]', context: 'hit', iters: 5_000_000 },
      { label: 'contains hit', op: 'match', selector: '[data-path*="commits"]',         context: 'hit', iters: 5_000_000 },
      { label: 'prefix hit',   op: 'match', selector: '[data-prefix^="commit"]',        context: 'hit', iters: 5_000_000 },
      { label: 'suffix hit',   op: 'match', selector: '[data-suffix$="commit"]',        context: 'hit', iters: 5_000_000 },
      { label: 'dash hit',     op: 'match', selector: '[lang|="en"]',                   context: 'hit', iters: 5_000_000 },
      { label: 'token hit',    op: 'match', selector: '[data-tags~="octicon"]',         context: 'hit', iters: 5_000_000 },

      { label: 'dash miss prefix only', op: 'match', selector: '[lang|="e"]',  context: 'hit', iters: 5_000_000 },
      { label: 'dash miss different',   op: 'match', selector: '[lang|="fr"]', context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute value operator misses',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-testid="author-avatar"
        data-tags="foo octicon bar"
        data-path="/repos/example/commits/abc"
        data-prefix="commit-start"
        data-suffix="end-commit"
        data-lang="en-US"
        lang="en-US"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exact miss',          op: 'match', selector: '[data-testid="other"]',   context: 'hit', iters: 5_000_000 },
      { label: 'contains miss',       op: 'match', selector: '[data-path*="branches"]', context: 'hit', iters: 5_000_000 },
      { label: 'prefix miss',         op: 'match', selector: '[data-prefix^="start"]',  context: 'hit', iters: 5_000_000 },
      { label: 'suffix miss',         op: 'match', selector: '[data-suffix$="start"]',  context: 'hit', iters: 5_000_000 },
      { label: 'dash miss',           op: 'match', selector: '[lang|="fr"]',            context: 'hit', iters: 5_000_000 },
      { label: 'token miss',          op: 'match', selector: '[data-tags~="missing"]',  context: 'hit', iters: 5_000_000 },
      { label: 'dash miss custom',    op: 'match', selector: '[data-lang|="fr"]',       context: 'hit', iters: 5_000_000 },
      { label: 'dash miss html-dflt', op: 'match', selector: '[lang|="fr"]',            context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute value operators forced insensitive',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-exact="AlphaBeta"
        data-path="/Repos/Example/Commits/ABC"
        data-prefix="Commit-Start"
        data-suffix="End-Commit"
        data-lang="EN-us"
        data-tags="foo UnitTest bar"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exact i hit',       op: 'match', selector: '[data-exact="alphabeta" i]',       context: 'hit', iters: 5_000_000 },
      { label: 'contains i hit',    op: 'match', selector: '[data-path*="commits" i]',         context: 'hit', iters: 5_000_000 },
      { label: 'prefix i hit',      op: 'match', selector: '[data-prefix^="commit" i]',        context: 'hit', iters: 5_000_000 },
      { label: 'suffix i hit',      op: 'match', selector: '[data-suffix$="commit" i]',        context: 'hit', iters: 5_000_000 },
      { label: 'dash i hit',        op: 'match', selector: '[data-lang|="en" i]',              context: 'hit', iters: 5_000_000 },
      { label: 'token i hit',       op: 'match', selector: '[data-tags~="unittest" i]',        context: 'hit', iters: 5_000_000 },

      { label: 'exact i miss',      op: 'match', selector: '[data-exact="other" i]',           context: 'hit', iters: 5_000_000 },
      { label: 'contains i miss',   op: 'match', selector: '[data-path*="branches" i]',        context: 'hit', iters: 5_000_000 },
      { label: 'prefix i miss',     op: 'match', selector: '[data-prefix^="start" i]',         context: 'hit', iters: 5_000_000 },
      { label: 'suffix i miss',     op: 'match', selector: '[data-suffix$="start" i]',         context: 'hit', iters: 5_000_000 },
      { label: 'dash i miss',       op: 'match', selector: '[data-lang|="fr" i]',              context: 'hit', iters: 5_000_000 },
      { label: 'token i miss',      op: 'match', selector: '[data-tags~="missing" i]',         context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute value case insensitive',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-kind="primary-action"
        data-tags="foo unitTest bar"
        lang="EN-us"
        type="BUTTON"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exact flag i',      op: 'match', selector: '[data-kind="PRIMARY-ACTION" i]', context: 'hit', iters: 5_000_000 },
      { label: 'token flag i',      op: 'match', selector: '[data-tags~="unitTEST" i]',      context: 'hit', iters: 5_000_000 },
      { label: 'dash flag i',       op: 'match', selector: '[lang|="en" i]',                 context: 'hit', iters: 5_000_000 },
      { label: 'html default type', op: 'match', selector: '[type="button"]',                context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match attribute namespace modes',
    // status: 'only',
    browsers: ['chromium'],
    engines: ['native'],
    markup: `
      <button
        id="hit"
        lang="en-US"
        data-x="value"
      ></button>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { op: 'match', selector: '[lang]',          context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[|lang]',         context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[*|lang]',        context: 'hit', iters: 5_000_000 },

      { op: 'match', selector: '[lang="en-US"]',  context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[|lang="en-US"]', context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[*|lang="en-US"]',context: 'hit', iters: 5_000_000, maxRatio: 7 },

      { op: 'match', selector: '[lang|="en"]',    context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[|lang|="en"]',   context: 'hit', iters: 5_000_000 },
      { op: 'match', selector: '[*|lang|="en"]',  context: 'hit', iters: 5_000_000, maxRatio: 7 },

      { op: 'match', selector: '[*|data-x="value"]', context: 'hit', iters: 5_000_000, maxRatio: 7 },
      { op: 'match', selector: '[*|data-x*="alu"]',  context: 'hit', iters: 5_000_000, maxRatio: 7 },
    ],
  },

  // wildcard namespace value selectors are slow because they must scan attributes;
  // duplicate same-localName attrs scale linearly;
  // misses are worse than hits because they cannot early-exit.
  {
    name: 'match attribute wildcard duplicate local names',
    // status: 'only',
    browsers: ['chromium'],
    markup: `<span id="hit"></span>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const el = document.getElementById('hit')!;
        el.setAttribute('foo', 'x');
        el.setAttributeNS('a', 'foo', 'x');
        el.setAttributeNS('b', 'foo', 'BAR');
        el.setAttributeNS('c', 'foo', 'x');
        el.setAttributeNS('d', 'foo', 'x');
        el.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'en-US');
      });
    },
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { op: 'match', selector: '[*|foo="bar" i]',  context: 'hit', iters: 5_000_000, maxRatio: 9 },
      { op: 'match', selector: '[*|foo="nope" i]', context: 'hit', iters: 5_000_000, maxRatio: 15 },
      { op: 'match', selector: '[*|lang|="en"]',   context: 'hit', iters: 5_000_000, maxRatio: 15 },
    ],
  },

  // Churn guard for ~=: isolated hot calls can favor regex, but selector churn favors the manual token path.
  {
    name: 'match attribute token hot vs churn',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <button
        id="hit"
        data-tags="foo octicon bar"
        data-kind="primary-action"
        data-path="/repos/example/commits/abc"
        data-prefix="commit-start"
        data-suffix="end-commit"
        lang="en-US"
        type="BUTTON"
      ></button>
      <button
        id="miss"
        data-tags="foo bar baz"
        data-kind="secondary-action"
        data-path="/repos/example/branches/abc"
        data-prefix="branch-start"
        data-suffix="end-branch"
        lang="fr-FR"
        type="RESET"
      ></button>
    `,
    quickIters: 20_000,
    probeKeys: ['match'],
    benches: [
      { label: 'token hot before churn', op: 'match', selector: '[data-tags~="octicon"]', context: 'hit', iters: 5_000_000 },
      {
        label: 'mixed attr churn', op: 'matchWalk', context: null, iters: 100_000,
        selectors: [
          '[data-tags~="octicon"]',
          '[data-tags~="missing"]',
          '[data-kind="primary-action"]',
          '[data-kind="PRIMARY-ACTION" i]',
          '[data-path*="commits"]',
          '[data-prefix^="commit"]',
          '[lang|="en"]',
          '[type="button"]',
        ],
      },
      {
        label: 'token pair churn', op: 'matchWalk', context: null, iters: 200_000,
        selectors: [
          '[data-tags~="foo"]',
          '[data-tags~="octicon"]',
        ],
      },
      { label: 'token hot after churn', op: 'match', selector: '[data-tags~="octicon"]', context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match class token paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="single" class="target"></div>
      <div id="first" class="target foo bar baz quux"></div>
      <div id="middle" class="foo bar target baz quux"></div>
      <div id="last" class="foo bar baz quux target"></div>
      <div id="miss" class="foo bar baz quux nope"></div>
      <div id="upper" class="Alpha beta Gamma"></div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        if (document.compatMode !== 'CSS1Compat') {
          throw new Error('Document is in quirks mode not standards mode');
        }
      });
    },
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'single hit',      op: 'match', selector: '.target',     context: 'single', iters: 5_000_000 },
      { label: 'first hit',       op: 'match', selector: '.target',     context: 'first',  iters: 5_000_000 },
      { label: 'middle hit',      op: 'match', selector: '.target',     context: 'middle', iters: 5_000_000 },
      { label: 'last hit',        op: 'match', selector: '.target',     context: 'last',   iters: 5_000_000 },
      { label: 'miss long',       op: 'match', selector: '.super_long', context: 'miss',   iters: 5_000_000 },
      { label: 'miss short',      op: 'match', selector: '.s',          context: 'miss',   iters: 5_000_000 },

      { label: 'case exact hit',  op: 'match', selector: '.Alpha',      context: 'upper',  iters: 5_000_000 },
      { label: 'case folded miss',op: 'match', selector: '.alpha',      context: 'upper',  iters: 5_000_000 },
    ],
  },

  {
    name: 'match class token quirks mode',
    // status: 'only',
    browsers: ['chromium'],
    markupMode: 'html-document',
    markup: `
      <html>
        <head></head>
        <body>
          <div id="hit" class="Alpha beta Gamma"></div>
          <div id="miss" class="foo beta gamma"></div>
        </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        if (document.compatMode === 'CSS1Compat') {
          throw new Error('Document is in standards mode not quirks mode');
        }
      });
    },
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'exact hit',       op: 'match', selector: '.Alpha', context: 'hit',  iters: 5_000_000 },
      { label: 'folded hit',      op: 'match', selector: '.alpha', context: 'hit',  iters: 5_000_000 },
      { label: 'folded miss',     op: 'match', selector: '.alpha', context: 'miss', iters: 5_000_000 },
    ],
  },

  {
    name: 'match combinators',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <section id="root">
        <div id="ancestor-hit" class="ancestor">
          <div id="parent-hit" class="parent">
            <span id="target" class="target"></span>
          </div>
        </div>

        <div id="sibling-box">
          <i id="general-left" class="general"></i>
          <b id="noise-1"></b>
          <b id="noise-2"></b>
          <span id="adjacent-left" class="adjacent"></span>
          <em id="sibling-target" class="target"></em>
        </div>

        <div id="miss-parent">
          <span id="miss-target" class="target"></span>
        </div>

        <div id="deep">
          <div><div><div><div><div><div><div><div>
            <span id="deep-target" class="target"></span>
          </div></div></div></div></div></div></div></div>
        </div>

        <div id="many-siblings">
          <i class="general"></i>
          <b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>
          <span id="far-sibling-target" class="target"></span>
        </div>
      </section>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      // Child combinator: one parentElement hop.
      { label: 'child hit', op: 'match', selector: '.parent > .target', context: 'target', iters: 5_000_000 },
      { label: 'child miss', op: 'match', selector: '.ancestor > .target', context: 'target', iters: 5_000_000 },

      // Descendant combinator: parentElement loop, early hit vs full miss.
      { label: 'descendant near hit', op: 'match', selector: '.parent .target', context: 'target', iters: 5_000_000 },
      { label: 'descendant far hit', op: 'match', selector: '#root .target', context: 'deep-target', iters: 5_000_000, maxRatio: 7 },
      { label: 'descendant miss', op: 'match', selector: '.missing .target', context: 'deep-target', iters: 5_000_000, maxRatio: 7 },

      // Adjacent sibling combinator: one previousElementSibling hop.
      { label: 'adjacent hit', op: 'match', selector: '.adjacent + .target', context: 'sibling-target', iters: 5_000_000 },
      { label: 'adjacent miss', op: 'match', selector: '.general + .target', context: 'sibling-target', iters: 5_000_000 },

      // General sibling combinator: previousElementSibling loop, early/far/miss.
      { label: 'general sibling near hit', op: 'match', selector: '.adjacent ~ .target', context: 'sibling-target', iters: 5_000_000 },
      { label: 'general sibling far hit', op: 'match', selector: '.general ~ .target', context: 'far-sibling-target', iters: 5_000_000 },
      { label: 'general sibling miss', op: 'match', selector: '.missing ~ .target', context: 'far-sibling-target', iters: 5_000_000 },
    ],
  },

]);
