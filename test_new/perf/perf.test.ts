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
      { op: 'match', selector: '[*|foo="bar" i]',  context: 'hit', iters: 5_000_000, maxRatio: 10 },
      { op: 'match', selector: '[*|foo="nope" i]', context: 'hit', iters: 5_000_000, maxRatio: 16 },
      { op: 'match', selector: '[*|lang|="en"]',   context: 'hit', iters: 5_000_000, maxRatio: 16 },
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
    quickIters: 100_000,
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

  {
    name: 'match structural pseudo root empty scope',
    // status: 'only',
    browsers: ['chromium'],
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html">
        <body id="body">
          <div id="host">
            <section id="empty"></section>
            <section id="comment-only"><!-- comment --></section>
            <section id="element-child"><span></span></section>
            <section id="text-child">text</section>
            <section id="ws-text">
            </section>
          </div>
        </body>
      </html>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'root hit html',          op: 'match', selector: ':root',  context: 'html',          iters: 5_000_000 },
      { label: 'root miss body',         op: 'match', selector: ':root',  context: 'body',          iters: 5_000_000 },

      { label: 'scope hit context',      op: 'match', selector: ':scope', context: 'host',          iters: 5_000_000 },
      { label: 'scope miss child',       op: 'match', selector: ':scope', context: 'empty',         iters: 5_000_000 },

      { label: 'empty hit empty',        op: 'match', selector: ':empty', context: 'empty',         iters: 5_000_000 },
      { label: 'empty hit comment-only', op: 'match', selector: ':empty', context: 'comment-only',  iters: 5_000_000 },
      { label: 'empty miss element',     op: 'match', selector: ':empty', context: 'element-child', iters: 5_000_000 },
      { label: 'empty miss text',        op: 'match', selector: ':empty', context: 'text-child',    iters: 5_000_000 },
      { label: 'empty miss whitespace',  op: 'match', selector: ':empty', context: 'ws-text',       iters: 5_000_000 },
    ],
  },

  {
    name: 'match structural pseudo child indexed',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="many">
        <span id="first"></span>
        <span id="middle"></span>
        <span id="last"></span>
      </div>
      <div id="single-parent">
        <span id="only"></span>
      </div>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'first-child hit',  op: 'match', selector: ':first-child', context: 'first',  iters: 5_000_000 },
      { label: 'first-child miss', op: 'match', selector: ':first-child', context: 'middle', iters: 5_000_000 },

      { label: 'last-child hit',   op: 'match', selector: ':last-child',  context: 'last',   iters: 5_000_000 },
      { label: 'last-child miss',  op: 'match', selector: ':last-child',  context: 'middle', iters: 5_000_000 },

      { label: 'only-child hit',   op: 'match', selector: ':only-child',  context: 'only',   iters: 5_000_000 },
      { label: 'only-child miss',  op: 'match', selector: ':only-child',  context: 'middle', iters: 5_000_000 },

      { label: 'first-child hit2',  op: 'match', selector: ':first-child', context: 'first',  iters: 5_000_000 },
      { label: 'first-child miss2', op: 'match', selector: ':first-child', context: 'middle', iters: 5_000_000 },
    ],
  },

  {
    name: 'match structural pseudo typed child indexed',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="typed">
        <i id="i-first"></i>
        <span id="span-only"></span>
        <b id="b1"></b>
        <i id="i-middle"></i>
        <b id="b2"></b>
        <i id="i-last"></i>
      </div>
      <div id="single-type">
        <em id="em-only"></em>
      </div>
      <div id="far-type">
        <u id="u-first"></u>
        <b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>
        <u id="u-last"></u>
      </div>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      { label: 'first-of-type hit first',  op: 'match', selector: ':first-of-type', context: 'i-first',  iters: 5_000_000 },
      { label: 'first-of-type miss middle',op: 'match', selector: ':first-of-type', context: 'i-middle', iters: 5_000_000 },
      { label: 'first-of-type far miss',   op: 'match', selector: ':first-of-type', context: 'u-last',   iters: 5_000_000 },

      { label: 'last-of-type hit last',    op: 'match', selector: ':last-of-type',  context: 'i-last',   iters: 5_000_000 },
      { label: 'last-of-type miss middle', op: 'match', selector: ':last-of-type',  context: 'i-middle', iters: 5_000_000 },
      { label: 'last-of-type far miss',    op: 'match', selector: ':last-of-type',  context: 'u-first',  iters: 5_000_000 },

      { label: 'only-of-type hit only',    op: 'match', selector: ':only-of-type',  context: 'span-only', iters: 5_000_000 },
      { label: 'only-of-type hit single',  op: 'match', selector: ':only-of-type',  context: 'em-only',   iters: 5_000_000 },
      { label: 'only-of-type miss first',  op: 'match', selector: ':only-of-type',  context: 'i-first',   iters: 5_000_000 },
      { label: 'only-of-type miss middle', op: 'match', selector: ':only-of-type',  context: 'i-middle',  iters: 5_000_000 },
      { label: 'only-of-type far miss',    op: 'match', selector: ':only-of-type',  context: 'u-first',   iters: 5_000_000 },
    ],
  },


  {
    name: 'match structural pseudo nth indexed',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <ul id="list">
        <li id="n1"></li><li id="n2"></li><li id="n3"></li><li id="n4"></li><li id="n5"></li><li id="n6"></li>
      </ul>
      <div id="typed">
        <i id="i1"></i><span id="s1"></span><i id="i2"></i><span id="s2"></span><i id="i3"></i><span id="s3"></span>
      </div>
      <div id="far">
        <b id="b1"></b><b id="b2"></b><b id="b3"></b><b id="b4"></b><b id="b5"></b>
        <b id="b6"></b><b id="b7"></b><b id="b8"></b><b id="b9"></b><b id="b10"></b>
      </div>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      // nth-child / nth-last-child use element index among all element siblings.
      { label: 'nth-child fixed hit',       op: 'match', selector: ':nth-child(3)',       context: 'n3',  iters: 5_000_000 },
      { label: 'nth-child fixed miss',      op: 'match', selector: ':nth-child(3)',       context: 'n4',  iters: 5_000_000 },
      { label: 'nth-child odd hit',         op: 'match', selector: ':nth-child(odd)',     context: 'n5',  iters: 5_000_000 },
      { label: 'nth-child even hit',        op: 'match', selector: ':nth-child(even)',    context: 'n6',  iters: 5_000_000 },
      { label: 'nth-child formula hit',     op: 'match', selector: ':nth-child(2n+1)',    context: 'n5',  iters: 5_000_000 },
      { label: 'nth-child formula miss',    op: 'match', selector: ':nth-child(2n+1)',    context: 'n6',  iters: 5_000_000 },

      { label: 'nth-last-child fixed hit',  op: 'match', selector: ':nth-last-child(2)',  context: 'n5',  iters: 5_000_000 },
      { label: 'nth-last-child fixed miss', op: 'match', selector: ':nth-last-child(2)',  context: 'n4',  iters: 5_000_000 },

      // nth-of-type / nth-last-of-type count only same localName/namespace siblings.
      { label: 'nth-of-type fixed hit',        op: 'match', selector: ':nth-of-type(2)',       context: 'i2', iters: 5_000_000 },
      { label: 'nth-of-type fixed miss',       op: 'match', selector: ':nth-of-type(2)',       context: 'i3', iters: 5_000_000 },
      { label: 'nth-of-type odd hit',          op: 'match', selector: ':nth-of-type(odd)',     context: 'i3', iters: 5_000_000 },
      { label: 'nth-of-type even hit',         op: 'match', selector: ':nth-of-type(even)',    context: 'i2', iters: 5_000_000 },

      { label: 'nth-last-of-type fixed hit',   op: 'match', selector: ':nth-last-of-type(1)',  context: 'i3', iters: 5_000_000 },
      { label: 'nth-last-of-type fixed miss',  op: 'match', selector: ':nth-last-of-type(1)',  context: 'i2', iters: 5_000_000 },

      // Longer sibling chain, mostly to expose counting/caching cost.
      { label: 'nth-child far fixed hit',      op: 'match', selector: ':nth-child(10)',        context: 'b10', iters: 5_000_000 },
      { label: 'nth-last-child far fixed hit', op: 'match', selector: ':nth-last-child(10)',   context: 'b1',  iters: 5_000_000 },
    ],
  },

  {
    name: 'match logical pseudo is/not',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <main id="root">
        <div id="hit" class="item foo bar" data-kind="primary"></div>
        <div id="miss" class="item baz" data-kind="secondary"></div>
      </main>
    `,
    quickIters: 200_000,
    probeKeys: ['match'],
    benches: [
      // Baselines
      { label: 'match class baseline hit', op: 'match', selector: '.foo', context: 'hit', iters: 5_000_000 },
      { label: 'match class baseline miss', op: 'match', selector: '.foo', context: 'miss', iters: 5_000_000 },

      // :is() single arm
      { label: 'match :is single hit', op: 'match', selector: ':is(.foo)', context: 'hit', iters: 5_000_000 },
      { label: 'match :is single miss', op: 'match', selector: ':is(.foo)', context: 'miss', iters: 5_000_000 },

      // :is() multi-arm, early hit / late hit / miss
      { label: 'match :is list early hit', op: 'match', selector: ':is(.foo, .nope, [data-x])', context: 'hit', iters: 5_000_000 },
      { label: 'match :is list late hit', op: 'match', selector: ':is(.nope, [data-x], .foo)', context: 'hit', iters: 5_000_000 },
      { label: 'match :is list miss', op: 'match', selector: ':is(.nope, [data-x], #absent)', context: 'hit', iters: 5_000_000 },

      // :not() simple
      { label: 'match :not simple pass', op: 'match', selector: ':not(.nope)', context: 'hit', iters: 5_000_000 },
      { label: 'match :not simple reject', op: 'match', selector: ':not(.foo)', context: 'hit', iters: 5_000_000 },

      // :not() list
      { label: 'match :not list pass', op: 'match', selector: ':not(.nope, [data-x], #absent)', context: 'hit', iters: 5_000_000 },
      { label: 'match :not list early reject', op: 'match', selector: ':not(.foo, .nope, [data-x])', context: 'hit', iters: 5_000_000 },
      { label: 'match :not list late reject', op: 'match', selector: ':not(.nope, [data-x], .foo)', context: 'hit', iters: 5_000_000 },
    ],
  },

  {
    name: 'match relational pseudo has',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 50_000,
    markup: `
      <main id="root">
        <section id="hit-desc" class="box">
          <div><div><span class="target"></span></div></div>
        </section>

        <section id="miss-desc" class="box">
          <div><div><span class="other"></span></div></div>
        </section>

        <section id="hit-child" class="box">
          <span class="target"></span>
        </section>

        <section id="miss-child" class="box">
          <div><span class="target"></span></div>
        </section>

        <section id="hit-adjacent" class="box"></section>
        <span class="target"></span>

        <section id="miss-adjacent" class="box"></section>
        <span class="other"></span>

        <section id="hit-sibling" class="box"></section>
        <span class="other"></span>
        <span class="target"></span>

        <section id="miss-sibling" class="box"></section>
        <span class="other"></span>
        <span class="other"></span>

        <section id="hit-nth-child" class="box">
          <span class="other"></span>
          <span class="target"></span>
          <span class="other"></span>
        </section>

        <section id="miss-nth-child" class="box">
          <span class="target"></span>
          <span class="other"></span>
          <span class="other"></span>
        </section>

        <section id="hit-nth-desc" class="box">
          <div>
            <span class="other"></span>
            <span class="target"></span>
            <span class="other"></span>
          </div>
        </section>

        <section id="miss-nth-desc" class="box">
          <div>
            <span class="target"></span>
            <span class="other"></span>
            <span class="other"></span>
          </div>
        </section>
      </main>
    `,
    probeKeys: ['match'],
    benches: [
      // Baselines
      { label: 'match class baseline hit',  op: 'match', selector: '.box', context: 'hit-desc',  iters: 1_000_000 },
      { label: 'match class baseline miss', op: 'match', selector: '.nope', context: 'hit-desc', iters: 1_000_000 },

      // Basic :has() combinators
      { label: 'match :has desc hit',     op: 'match', selector: ':has(.target)',    context: 'hit-desc',      iters: 1_000_000 },
      { label: 'match :has desc miss',    op: 'match', selector: ':has(.target)',    context: 'miss-desc',     iters: 1_000_000 },
      { label: 'match :has child hit',    op: 'match', selector: ':has(> .target)',  context: 'hit-child',     iters: 1_000_000 },
      { label: 'match :has child miss',   op: 'match', selector: ':has(> .target)',  context: 'miss-child',    iters: 1_000_000 },
      { label: 'match :has next hit',     op: 'match', selector: ':has(+ .target)',  context: 'hit-adjacent',  iters: 1_000_000 },
      { label: 'match :has next miss',    op: 'match', selector: ':has(+ .target)',  context: 'miss-adjacent', iters: 1_000_000 },
      { label: 'match :has sibling hit',  op: 'match', selector: ':has(~ .target)',  context: 'hit-sibling',   iters: 1_000_000 },
      { label: 'match :has sibling miss', op: 'match', selector: ':has(~ .target)',  context: 'miss-sibling',  iters: 1_000_000 },

      // :has() with nth selectors inside the relative selector.
      { label: 'match :has child nth hit',  op: 'match', selector: ':has(> .target:nth-child(2))', context: 'hit-nth-child',  iters: 1_000_000 },
      { label: 'match :has child nth miss', op: 'match', selector: ':has(> .target:nth-child(2))', context: 'miss-nth-child', iters: 1_000_000 },
      { label: 'match :has desc nth hit',   op: 'match', selector: ':has(.target:nth-child(2))',   context: 'hit-nth-desc',   iters: 1_000_000 },
      { label: 'match :has desc nth miss',  op: 'match', selector: ':has(.target:nth-child(2))',   context: 'miss-nth-desc',  iters: 1_000_000 },
    ],
  },

  {
    name: 'match linguistic pseudo dir/lang',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 100_000,
    markup: `
      <main id="root" lang="en-US" dir="ltr">
        <section id="lang-hit">
          <div><span id="lang-inherit-hit"></span></div>
        </section>

        <section id="lang-miss" lang="fr">
          <span id="lang-inherit-miss"></span>
        </section>

        <section id="dir-hit">
          <div><span id="dir-inherit-hit"></span></div>
        </section>

        <section id="dir-miss" dir="rtl">
          <span id="dir-inherit-miss"></span>
        </section>

        <section id="dir-auto-ltr" dir="auto">hello world</section>
        <section id="dir-auto-rtl" dir="auto">שלום עולם</section>
        <bdi id="bdi-auto-rtl">שלום</bdi>
      </main>
    `,
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#lang-inherit-hit', context: 'lang-inherit-hit', iters: 1_000_000 },
      { label: 'match :lang inherited hit', op: 'match', selector: ':lang(en)', context: 'lang-inherit-hit', iters: 1_000_000 },
      { label: 'match :lang inherited miss', op: 'match', selector: ':lang(en)', context: 'lang-inherit-miss', iters: 1_000_000 },

      { label: 'match :dir inherited hit', op: 'match', selector: ':dir(ltr)', context: 'dir-inherit-hit', iters: 1_000_000, maxRatio: 6 },
      { label: 'match :dir inherited miss', op: 'match', selector: ':dir(ltr)', context: 'dir-inherit-miss', iters: 1_000_000 },

      { label: 'match :dir auto ltr hit', op: 'match', selector: ':dir(ltr)', context: 'dir-auto-ltr', iters: 1_000_000 },
      { label: 'match :dir auto rtl hit', op: 'match', selector: ':dir(rtl)', context: 'dir-auto-rtl', iters: 1_000_000 },
      { label: 'match :dir bdi auto rtl hit', op: 'match', selector: ':dir(rtl)', context: 'bdi-auto-rtl', iters: 1_000_000 },
    ],
  },

  {
    name: 'match location pseudo classes',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 200_000,
    markup: `
      <main id="root">
        <a id="link-hit" href="/x">link</a>
        <a id="link-miss">no href</a>
        <area id="area-hit" href="/map"></area>
        <div id="plain"></div>

        <section id="target"></section>
        <section id="not-target"></section>

        <div id="defined-div"></div>
        <x-loc-defined id="defined-custom"></x-loc-defined>
        <x-loc-unknown id="undefined-custom"></x-loc-unknown>
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        history.replaceState(null, '', '#target');
        customElements.define('x-loc-defined', class extends HTMLElement {});
      });
    },
    probeKeys: ['match'],
    benches: [
      // Baselines
      { label: 'match baseline id hit', op: 'match', selector: '#plain', context: 'plain', iters: 5_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', context: 'plain', iters: 5_000_000 },

      // :any-link / :link
      { label: 'match :any-link a hit', op: 'match', selector: ':any-link', context: 'link-hit', iters: 5_000_000 },
      { label: 'match :any-link a miss', op: 'match', selector: ':any-link', context: 'link-miss', iters: 5_000_000 },
      { label: 'match :any-link area hit', op: 'match', selector: ':any-link', context: 'area-hit', iters: 5_000_000 },
      { label: 'match :link a hit', op: 'match', selector: ':link', context: 'link-hit', iters: 5_000_000 },
      { label: 'match :visited false', op: 'match', selector: ':visited', context: 'link-hit', iters: 5_000_000 },

      // :target
      { label: 'match :target hit', op: 'match', selector: ':target', context: 'target', iters: 5_000_000, maxRatio: 8 },
      { label: 'match :target miss', op: 'match', selector: ':target', context: 'not-target', iters: 5_000_000, maxRatio: 8 },

      // :defined
      { label: 'match :defined builtin hit', op: 'match', selector: ':defined', context: 'defined-div', iters: 5_000_000 },
      { label: 'match :defined custom hit', op: 'match', selector: ':defined', context: 'defined-custom', iters: 5_000_000, maxRatio: 8 },
      { label: 'match :defined custom miss', op: 'match', selector: ':defined', context: 'undefined-custom', iters: 5_000_000, maxRatio: 8 },
    ],
  },

  {
    name: 'match user action hover pseudo',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 200_000,
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <button id="inner" style="display:block;width:20px;height:20px;padding:0;"></button>
      </div>
      <div id="other" style="width:20px;height:20px;"></div>
    `,
    setupPage: async page => {
      await page.locator('#inner').hover();
    },
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#inner', context: 'inner', iters: 5_000_000 },
      { label: 'match :hover self hit', op: 'match', selector: ':hover', context: 'inner', iters: 5_000_000 },
      { label: 'match :hover ancestor hit', op: 'match', selector: ':hover', context: 'outer', iters: 5_000_000 },
      { label: 'match :hover miss', op: 'match', selector: ':hover', context: 'other', iters: 5_000_000 },
    ],
  },

  {
    name: 'match user action active/focus pseudo',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 200_000,
    markup: `
      <div id="active-outer" style="width:40px;height:40px;">
        <button id="active-inner" style="display:block;width:20px;height:20px;padding:0;"></button>
      </div>
      <div id="active-other" style="width:20px;height:20px;"></div>

      <div id="focus-outer">
        <input id="focus-inner">
      </div>
      <input id="focus-other">
    `,
    setupPage: async page => {
      await page.locator('#focus-inner').focus();
      await page.locator('#active-inner').hover();
      await page.mouse.down();
    },
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#active-inner', context: 'active-inner', iters: 5_000_000 },

      { label: 'match :active self hit', op: 'match', selector: ':active', context: 'active-inner', iters: 5_000_000 },
      { label: 'match :active ancestor hit', op: 'match', selector: ':active', context: 'active-outer', iters: 5_000_000 },
      { label: 'match :active miss', op: 'match', selector: ':active', context: 'active-other', iters: 5_000_000 },

      { label: 'match :focus hit', op: 'match', selector: ':focus', context: 'focus-inner', iters: 5_000_000, maxRatio: 6 },
      { label: 'match :focus miss', op: 'match', selector: ':focus', context: 'focus-other', iters: 5_000_000 },
      { label: 'match :focus-visible hit', op: 'match', selector: ':focus-visible', context: 'focus-inner', iters: 5_000_000, maxRatio: 6 },

      { label: 'match :focus-within self hit', op: 'match', selector: ':focus-within', context: 'focus-inner', iters: 5_000_000 },
      { label: 'match :focus-within ancestor hit', op: 'match', selector: ':focus-within', context: 'focus-outer', iters: 5_000_000 },
      { label: 'match :focus-within miss', op: 'match', selector: ':focus-within', context: 'focus-other', iters: 5_000_000 },
    ],
  },

  {
    name: 'match input state pseudo classes',
    // status: 'only',
    browsers: ['chromium'],
    // browsers: ['firefox'],
    quickIters: 100_000,
    markup: `
      <form id="form">
        <input id="enabled-input">
        <input id="disabled-input" disabled>

        <fieldset id="disabled-fieldset" disabled>
          <input id="fieldset-disabled-input">
        </fieldset>

        <input id="readonly-input" readonly>
        <input id="readwrite-input">
        <div id="editable" contenteditable="true"></div>
        <div id="plain"></div>

        <input id="placeholder-empty" placeholder="name">
        <input id="placeholder-filled" placeholder="name" value="x">

        <input id="default-checked" type="checkbox" checked>
        <input id="not-default-checked" type="checkbox">

        <select id="select">
          <option id="default-option" selected>one</option>
          <option id="not-default-option">two</option>
        </select>
      </form>
    `,
    probeKeys: ['match'],
    benches: [
      // Baselines
      { label: 'match baseline id hit', op: 'match', selector: '#enabled-input', context: 'enabled-input', iters: 1_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', context: 'enabled-input', iters: 1_000_000 },

      // :enabled / :disabled
      { label: 'match :enabled hit', op: 'match', selector: ':enabled', context: 'enabled-input', iters: 1_000_000, maxRatio: 14 },
      { label: 'match :enabled miss disabled', op: 'match', selector: ':enabled', context: 'disabled-input', iters: 1_000_000 },
      { label: 'match :disabled direct hit', op: 'match', selector: ':disabled', context: 'disabled-input', iters: 1_000_000 },
      { label: 'match :disabled fieldset hit', op: 'match', selector: ':disabled', context: 'fieldset-disabled-input', iters: 1_000_000 },
      { label: 'match :disabled miss', op: 'match', selector: ':disabled', context: 'enabled-input', iters: 1_000_000, maxRatio: 14 },

      // :read-only / :read-write
      { label: 'match :read-only readonly hit', op: 'match', selector: ':read-only', context: 'readonly-input', iters: 1_000_000 },
      { label: 'match :read-only plain hit', op: 'match', selector: ':read-only', context: 'plain', iters: 1_000_000, maxRatio: 17 },
      { label: 'match :read-write input hit', op: 'match', selector: ':read-write', context: 'readwrite-input', iters: 1_000_000, maxRatio: 14  },
      { label: 'match :read-write editable hit', op: 'match', selector: ':read-write', context: 'editable', iters: 1_000_000 },
      { label: 'match :read-write readonly miss', op: 'match', selector: ':read-write', context: 'readonly-input', iters: 1_000_000 },

      // :placeholder-shown
      { label: 'match :placeholder-shown hit', op: 'match', selector: ':placeholder-shown', context: 'placeholder-empty', iters: 1_000_000 },
      { label: 'match :placeholder-shown miss filled', op: 'match', selector: ':placeholder-shown', context: 'placeholder-filled', iters: 1_000_000 },
      { label: 'match :placeholder-shown miss plain', op: 'match', selector: ':placeholder-shown', context: 'plain', iters: 1_000_000 },

      // :default
      { label: 'match :default checked hit', op: 'match', selector: ':default', context: 'default-checked', iters: 1_000_000 },
      { label: 'match :default checkbox miss', op: 'match', selector: ':default', context: 'not-default-checked', iters: 1_000_000 },
      { label: 'match :default option hit', op: 'match', selector: ':default', context: 'default-option', iters: 1_000_000 },
      { label: 'match :default option miss', op: 'match', selector: ':default', context: 'not-default-option', iters: 1_000_000 },
    ],
  },

  {
    name: 'match form validation pseudo classes',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 25_000,
    markup: `
      <form id="form">
        <input id="checked-box" type="checkbox" checked>
        <input id="unchecked-box" type="checkbox">
        <input id="checked-radio" type="radio" name="r" checked>
        <input id="unchecked-radio" type="radio" name="r">
        <select id="select">
          <option id="selected-option" selected>one</option>
          <option id="unselected-option">two</option>
        </select>

        <input id="required-empty" required>
        <input id="optional-empty">
        <input id="required-filled" required value="x">

        <input id="email-valid" type="email" value="a@b.test">
        <input id="email-invalid" type="email" value="not-an-email">
        <input id="pattern-valid" pattern="[0-9]+" value="123">
        <input id="pattern-invalid" pattern="[0-9]+" value="abc">

        <input id="range-in" type="number" min="1" max="10" value="5">
        <input id="range-under" type="number" min="1" max="10" value="0">
        <input id="range-over" type="number" min="1" max="10" value="11">
        <input id="range-empty" type="number" min="1" max="10">

        <progress id="progress-indeterminate"></progress>
        <progress id="progress-determinate" value="1" max="10"></progress>
        <input id="checkbox-indeterminate" type="checkbox">
        <div id="plain"></div>
      </form>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        (document.getElementById('checkbox-indeterminate') as HTMLInputElement).indeterminate = true;
      });
    },
    probeKeys: ['match'],
    benches: [
      // Baselines
      { label: 'match baseline id hit', op: 'match', selector: '#checked-box', context: 'checked-box', iters: 1_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', context: 'checked-box', iters: 1_000_000 },

      // :checked
      { label: 'match :checked checkbox hit', op: 'match', selector: ':checked', context: 'checked-box', iters: 1_000_000 },
      { label: 'match :checked checkbox miss', op: 'match', selector: ':checked', context: 'unchecked-box', iters: 1_000_000 },
      { label: 'match :checked radio hit', op: 'match', selector: ':checked', context: 'checked-radio', iters: 1_000_000 },
      { label: 'match :checked radio miss', op: 'match', selector: ':checked', context: 'unchecked-radio', iters: 1_000_000 },
      { label: 'match :checked option hit', op: 'match', selector: ':checked', context: 'selected-option', iters: 1_000_000 },
      { label: 'match :checked option miss', op: 'match', selector: ':checked', context: 'unselected-option', iters: 1_000_000 },

      // :indeterminate
      { label: 'match :indeterminate checkbox hit', op: 'match', selector: ':indeterminate', context: 'checkbox-indeterminate', iters: 1_000_000 },
      { label: 'match :indeterminate checkbox miss', op: 'match', selector: ':indeterminate', context: 'unchecked-box', iters: 1_000_000 },
      { label: 'match :indeterminate progress hit', op: 'match', selector: ':indeterminate', context: 'progress-indeterminate', iters: 1_000_000 },
      { label: 'match :indeterminate progress miss', op: 'match', selector: ':indeterminate', context: 'progress-determinate', iters: 1_000_000 },

      // :required / :optional
      { label: 'match :required hit', op: 'match', selector: ':required', context: 'required-empty', iters: 1_000_000 },
      { label: 'match :required miss optional', op: 'match', selector: ':required', context: 'optional-empty', iters: 1_000_000 },
      { label: 'match :required miss plain', op: 'match', selector: ':required', context: 'plain', iters: 1_000_000 },
      { label: 'match :optional hit', op: 'match', selector: ':optional', context: 'optional-empty', iters: 1_000_000 },
      { label: 'match :optional miss required', op: 'match', selector: ':optional', context: 'required-empty', iters: 1_000_000 },
      { label: 'match :optional miss plain', op: 'match', selector: ':optional', context: 'plain', iters: 1_000_000 },

      // :valid / :invalid
      { label: 'match :valid required filled hit', op: 'match', selector: ':valid', context: 'required-filled', iters: 1_000_000 },
      { label: 'match :valid email hit', op: 'match', selector: ':valid', context: 'email-valid', iters: 1_000_000 },
      { label: 'match :valid email miss', op: 'match', selector: ':valid', context: 'email-invalid', iters: 1_000_000, maxRatio: 10 },
      { label: 'match :valid plain miss', op: 'match', selector: ':valid', context: 'plain', iters: 1_000_000 },
      { label: 'match :invalid required empty hit', op: 'match', selector: ':invalid', context: 'required-empty', iters: 1_000_000, maxRatio: 12 },
      { label: 'match :invalid email hit', op: 'match', selector: ':invalid', context: 'email-invalid', iters: 1_000_000, maxRatio: 11 },
      { label: 'match :invalid email miss', op: 'match', selector: ':invalid', context: 'email-valid', iters: 1_000_000 },
      { label: 'match :invalid plain miss', op: 'match', selector: ':invalid', context: 'plain', iters: 1_000_000 },

      // :in-range / :out-of-range
      { label: 'match :in-range hit', op: 'match', selector: ':in-range', context: 'range-in', iters: 1_000_000 },
      { label: 'match :in-range miss under', op: 'match', selector: ':in-range', context: 'range-under', iters: 1_000_000 },
      { label: 'match :in-range miss empty', op: 'match', selector: ':in-range', context: 'range-empty', iters: 1_000_000 },
      { label: 'match :in-range miss plain', op: 'match', selector: ':in-range', context: 'plain', iters: 1_000_000 },
      { label: 'match :out-of-range under hit', op: 'match', selector: ':out-of-range', context: 'range-under', iters: 1_000_000 },
      { label: 'match :out-of-range over hit', op: 'match', selector: ':out-of-range', context: 'range-over', iters: 1_000_000 },
      { label: 'match :out-of-range miss in', op: 'match', selector: ':out-of-range', context: 'range-in', iters: 1_000_000 },
      { label: 'match :out-of-range miss empty', op: 'match', selector: ':out-of-range', context: 'range-empty', iters: 1_000_000 },
    ],
  },

  {
    name: 'match resource state pseudo classes',
    // status: 'only',
    browsers: ['webkit'],
    engines: ['native', 'nw-current'],
    quickIters: 200_000,
    markup: `
      <video id="video"></video>
      <audio id="audio" muted></audio>
      <div id="plain"></div>
    `,
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#video', context: 'video', iters: 1_000_000 },

      { label: 'match :muted hit', op: 'match', selector: ':muted', context: 'audio', iters: 1_000_000 },
      { label: 'match :muted miss media', op: 'match', selector: ':muted', context: 'video', iters: 1_000_000 },
      { label: 'match :muted miss plain', op: 'match', selector: ':muted', context: 'plain', iters: 1_000_000 },

      { label: 'match :paused media', op: 'match', selector: ':paused', context: 'video', iters: 1_000_000 },
      { label: 'match :playing miss media', op: 'match', selector: ':playing', context: 'video', iters: 1_000_000 },
      { label: 'match :seeking miss media', op: 'match', selector: ':seeking', context: 'video', iters: 1_000_000 },
    ],
  },

]);
