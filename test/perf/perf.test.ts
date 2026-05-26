import { readFileSync } from 'node:fs';
import { runPerfScenarios } from './harness/perf-scenario';

const htmlStandard = readFileSync('test/browser/fixtures/slick/template-standard.html', 'utf8');

const idMarkup = (n: number) =>
  Array.from({ length: n }, (_, i) => `<div id="n${i}"></div>`).join('');

const shuffled = (n: number) => {
  const xs = Array.from({ length: n }, (_, i) => i);
  let x = 7;

  for (let i = n - 1; i > 0; --i) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const j = x % (i + 1);
    const t = xs[i];
    xs[i] = xs[j];
    xs[j] = t;
  }

  return xs;
};

const groupedIds = (n: number) =>
  shuffled(n).map((i) => `#n${i}`).join(', ');

const groupedDupedIds = (n: number) => {
  const xs = shuffled(n);
  const dupes = xs.filter((_, i) => i % 3 === 0);
  return xs.concat(dupes).map((i) => `#n${i}`).join(', ');
};

runPerfScenarios('perf', [
  {
    name: 'blob mixed overview',
    // status: 'only',
    status: 'skip',
    browsers: ['chromium'],
    markup: htmlStandard,
    probeKeys: ['select', 'selBuild', 'match', 'matBuild'],
    benches: [
      { label: 'select div',                op: 'select', selector: 'div',                   iters: 200 },
      { label: 'select .comment',           op: 'select', selector: '.comment',              iters: 200 },
      { label: 'select [data-testid]',      op: 'select', selector: '[data-testid]',         iters: 200 },
      { label: 'select a[href*="commits"]', op: 'select', selector: 'a[href*="commits"]',    iters: 200 },
      { label: 'select textarea',           op: 'select', selector: 'textarea',              iters: 200 },
      { label: 'select button',             op: 'select', selector: 'button',                iters: 200 },
      { label: 'select [popover]',          op: 'select', selector: '[popover]',             iters: 200 },
      { label: 'select :not(button)',       op: 'select', selector: ':not(button)',          iters: 200 },
      { label: 'select :is(div, span, a)',  op: 'select', selector: ':is(div, span, a)',     iters: 200 },

      { label: 'first div',                 op: 'first', selector: 'div',                    iters: 500 },
      { label: 'first .comment',            op: 'first', selector: '.comment',               iters: 500 },
      { label: 'first [data-testid]',       op: 'first', selector: '[data-testid]',          iters: 500 },
      { label: 'first a[href*="commits"]',  op: 'first', selector: 'a[href*="commits"]',     iters: 500 },
      { label: 'first textarea',            op: 'first', selector: 'textarea',               iters: 500 },
      { label: 'first button',              op: 'first', selector: 'button',                 iters: 500 },
      { label: 'first [popover]',           op: 'first', selector: '[popover]',              iters: 500 },
      { label: 'first :not(button)',        op: 'first', selector: ':not(button)',           iters: 500 },
      { label: 'first :is(div, span, a)',   op: 'first', selector: ':is(div, span, a)',      iters: 500 },

      { label: 'match walk remove group',   op: 'matchWalk', selectors: ['button', '[popover]', '[data-testid="author-avatar"]'], iters: 20 },
      { label: 'match walk replace group',  op: 'matchWalk', selectors: ['textarea', 'div', 'p'], iters: 20 },
      { label: 'match walk links group',    op: 'matchWalk', selectors: ['a[href*="commits"]', '[class*="codeBlobInner"] textarea'], iters: 20 },
      { label: 'match walk code group',     op: 'matchWalk', selectors: ['pre', 'code', '.highlight'], iters: 20 },
      { label: 'walk only',                 op: 'matchWalk', selectors: [], iters: 50 },
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
      { label: 'match universal hit', op: 'match', selector: '*', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'match id hit',  op: 'match', selector: '#search-icon', ref: { by: 'id', id: 'search-icon' }, iters: 5_000_000 },
      { label: 'match id miss', op: 'match', selector: '#search-icon', ref: { by: 'id', id: 'miss' },        iters: 5_000_000 },
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
      { label: 'match class hit',  op: 'match', selector: '.octicon', ref: { by: 'id', id: 'hit' },  iters: 5_000_000 },
      { label: 'match class miss', op: 'match', selector: '.octicon', ref: { by: 'id', id: 'miss' }, iters: 5_000_000 },
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
      { label: 'match tag div hit',     op: 'match', selector: 'div',      ref: { by: 'id', id: 'div' },      iters: 5_000_000 },
      { label: 'match tag div miss',    op: 'match', selector: 'div',      ref: { by: 'id', id: 'button' },   iters: 5_000_000 },
      { label: 'match tag button hit',  op: 'match', selector: 'button',   ref: { by: 'id', id: 'button' },   iters: 5_000_000 },
      { label: 'match tag textarea hit', op: 'match', selector: 'textarea', ref: { by: 'id', id: 'textarea' }, iters: 5_000_000 },
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
      { label: 'match namespace any hit null', op: 'match', selector: '*|foo', ref: { by: 'id', id: 'null-foo' }, iters: 5_000_000 },
      { label: 'match namespace any hit ns',   op: 'match', selector: '*|foo', ref: { by: 'id', id: 'ns-foo' },   iters: 5_000_000 },
      { label: 'match namespace null hit',     op: 'match', selector: '|foo',  ref: { by: 'id', id: 'null-foo' }, iters: 5_000_000 },
      { label: 'match namespace null miss ns', op: 'match', selector: '|foo',  ref: { by: 'id', id: 'ns-foo' },   iters: 5_000_000 },
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
      { label: 'exists',       op: 'match', selector: '[data-testid]',                  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'exact',        op: 'match', selector: '[data-testid="author-avatar"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'contains',     op: 'match', selector: '[data-path*="commits"]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token',        op: 'match', selector: '[data-tags~="octicon"]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'prefix',       op: 'match', selector: '[data-prefix^="commit"]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'suffix',       op: 'match', selector: '[data-suffix$="commit"]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'ns dash',      op: 'match', selector: '[lang|="en"]',                   ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'star dash',    op: 'match', selector: '[*|lang|="en"]',                 ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 18 },
      { label: 'flag i',       op: 'match', selector: '[data-kind="PRIMARY-ACTION" i]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'html default', op: 'match', selector: '[type="button"]',                ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'exists hit',  op: 'match', selector: '[data-testid]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'exists miss', op: 'match', selector: '[data-missing]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'wildcard html hit', op: 'match', selector: '[*|TiTlE]',    ref: { by: 'id', id: 'html-hit' }, iters: 5_000_000, maxRatio: 6 },
      { label: 'wildcard html miss', op: 'match', selector: '[*|missing]', ref: { by: 'id', id: 'html-hit' }, iters: 5_000_000, maxRatio: 7 },
      { label: 'colon html hit', op: 'match', selector: '[foo\\:bar]',     ref: { by: 'id', id: 'html-hit' }, iters: 5_000_000, maxRatio: 7 },
      { label: 'colon html miss', op: 'match', selector: '[bar\\:foo]',    ref: { by: 'id', id: 'html-hit' }, iters: 5_000_000, maxRatio: 7 },
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
      { label: 'exact hit',    op: 'match', selector: '[data-testid="author-avatar"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'contains hit', op: 'match', selector: '[data-path*="commits"]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'prefix hit',   op: 'match', selector: '[data-prefix^="commit"]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'suffix hit',   op: 'match', selector: '[data-suffix$="commit"]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash hit',     op: 'match', selector: '[lang|="en"]',                   ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token hit',    op: 'match', selector: '[data-tags~="octicon"]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },

      { label: 'dash miss prefix only', op: 'match', selector: '[lang|="e"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash miss different',   op: 'match', selector: '[lang|="fr"]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'exact miss',          op: 'match', selector: '[data-testid="other"]',   ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'contains miss',       op: 'match', selector: '[data-path*="branches"]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'prefix miss',         op: 'match', selector: '[data-prefix^="start"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'suffix miss',         op: 'match', selector: '[data-suffix$="start"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash miss',           op: 'match', selector: '[lang|="fr"]',            ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token miss',          op: 'match', selector: '[data-tags~="missing"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash miss custom',    op: 'match', selector: '[data-lang|="fr"]',       ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash miss html-dflt', op: 'match', selector: '[lang|="fr"]',            ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'exact i hit',       op: 'match', selector: '[data-exact="alphabeta" i]',       ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'contains i hit',    op: 'match', selector: '[data-path*="commits" i]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'prefix i hit',      op: 'match', selector: '[data-prefix^="commit" i]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'suffix i hit',      op: 'match', selector: '[data-suffix$="commit" i]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash i hit',        op: 'match', selector: '[data-lang|="en" i]',              ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token i hit',       op: 'match', selector: '[data-tags~="unittest" i]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },

      { label: 'exact i miss',      op: 'match', selector: '[data-exact="other" i]',           ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'contains i miss',   op: 'match', selector: '[data-path*="branches" i]',        ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'prefix i miss',     op: 'match', selector: '[data-prefix^="start" i]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'suffix i miss',     op: 'match', selector: '[data-suffix$="start" i]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash i miss',       op: 'match', selector: '[data-lang|="fr" i]',              ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token i miss',      op: 'match', selector: '[data-tags~="missing" i]',         ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'exact flag i',      op: 'match', selector: '[data-kind="PRIMARY-ACTION" i]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'token flag i',      op: 'match', selector: '[data-tags~="unitTEST" i]',      ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'dash flag i',       op: 'match', selector: '[lang|="en" i]',                 ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'html default type', op: 'match', selector: '[type="button"]',                ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { op: 'match', selector: '[lang]',             ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[|lang]',            ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[*|lang]',           ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },

      { op: 'match', selector: '[lang="en-US"]',     ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[|lang="en-US"]',    ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[*|lang="en-US"]',   ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 7 },

      { op: 'match', selector: '[lang|="en"]',       ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[|lang|="en"]',      ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { op: 'match', selector: '[*|lang|="en"]',     ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 7 },

      { op: 'match', selector: '[*|data-x="value"]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 7 },
      { op: 'match', selector: '[*|data-x*="alu"]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 7 },
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
      { op: 'match', selector: '[*|foo="bar" i]',  ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 10 },
      { op: 'match', selector: '[*|foo="nope" i]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 16 },
      { op: 'match', selector: '[*|lang|="en"]',   ref: { by: 'id', id: 'hit' }, iters: 5_000_000, maxRatio: 16 },
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
      { label: 'token hot before churn', op: 'match', selector: '[data-tags~="octicon"]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      {
        label: 'mixed attr churn', op: 'matchWalk', iters: 100_000,
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
        label: 'token pair churn', op: 'matchWalk', iters: 200_000,
        selectors: [
          '[data-tags~="foo"]',
          '[data-tags~="octicon"]',
        ],
      },
      { label: 'token hot after churn', op: 'match', selector: '[data-tags~="octicon"]', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'single hit',      op: 'match', selector: '.target',     ref: { by: 'id', id: 'single' }, iters: 5_000_000 },
      { label: 'first hit',       op: 'match', selector: '.target',     ref: { by: 'id', id: 'first' },  iters: 5_000_000 },
      { label: 'middle hit',      op: 'match', selector: '.target',     ref: { by: 'id', id: 'middle' }, iters: 5_000_000 },
      { label: 'last hit',        op: 'match', selector: '.target',     ref: { by: 'id', id: 'last' },   iters: 5_000_000 },
      { label: 'miss long',       op: 'match', selector: '.super_long', ref: { by: 'id', id: 'miss' },   iters: 5_000_000 },
      { label: 'miss short',      op: 'match', selector: '.s',          ref: { by: 'id', id: 'miss' },   iters: 5_000_000 },

      { label: 'case exact hit',  op: 'match', selector: '.Alpha',      ref: { by: 'id', id: 'upper' },  iters: 5_000_000 },
      { label: 'case folded miss', op: 'match', selector: '.alpha',      ref: { by: 'id', id: 'upper' },  iters: 5_000_000 },
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
      { label: 'exact hit',       op: 'match', selector: '.Alpha', ref: { by: 'id', id: 'hit' },  iters: 5_000_000 },
      { label: 'folded hit',      op: 'match', selector: '.alpha', ref: { by: 'id', id: 'hit' },  iters: 5_000_000 },
      { label: 'folded miss',     op: 'match', selector: '.alpha', ref: { by: 'id', id: 'miss' }, iters: 5_000_000 },
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
      { label: 'child hit', op: 'match', selector: '.parent > .target', ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { label: 'child miss', op: 'match', selector: '.ancestor > .target', ref: { by: 'id', id: 'target' }, iters: 5_000_000 },

      // Descendant combinator: parentElement loop, early hit vs full miss.
      { label: 'descendant near hit', op: 'match', selector: '.parent .target', ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { label: 'descendant far hit', op: 'match', selector: '#root .target', ref: { by: 'id', id: 'deep-target' }, iters: 5_000_000, maxRatio: 7 },
      { label: 'descendant miss', op: 'match', selector: '.missing .target', ref: { by: 'id', id: 'deep-target' }, iters: 5_000_000, maxRatio: 7 },

      // Adjacent sibling combinator: one previousElementSibling hop.
      { label: 'adjacent hit', op: 'match', selector: '.adjacent + .target', ref: { by: 'id', id: 'sibling-target' }, iters: 5_000_000 },
      { label: 'adjacent miss', op: 'match', selector: '.general + .target', ref: { by: 'id', id: 'sibling-target' }, iters: 5_000_000 },

      // General sibling combinator: previousElementSibling loop, early/far/miss.
      { label: 'general sibling near hit', op: 'match', selector: '.adjacent ~ .target', ref: { by: 'id', id: 'sibling-target' }, iters: 5_000_000 },
      { label: 'general sibling far hit', op: 'match', selector: '.general ~ .target', ref: { by: 'id', id: 'far-sibling-target' }, iters: 5_000_000 },
      { label: 'general sibling miss', op: 'match', selector: '.missing ~ .target', ref: { by: 'id', id: 'far-sibling-target' }, iters: 5_000_000 },
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
      { label: 'root hit html',          op: 'match', selector: ':root',  ref: { by: 'id', id: 'html' },          iters: 5_000_000 },
      { label: 'root miss body',         op: 'match', selector: ':root',  ref: { by: 'id', id: 'body' },          iters: 5_000_000 },

      { label: 'scope hit context',      op: 'match', selector: ':scope', ref: { by: 'id', id: 'host' },          iters: 5_000_000 },
      { label: 'scope miss child',       op: 'match', selector: ':scope', ref: { by: 'id', id: 'empty' },         iters: 5_000_000 },

      { label: 'empty hit empty',        op: 'match', selector: ':empty', ref: { by: 'id', id: 'empty' },         iters: 5_000_000 },
      { label: 'empty hit comment-only', op: 'match', selector: ':empty', ref: { by: 'id', id: 'comment-only' },  iters: 5_000_000 },
      { label: 'empty miss element',     op: 'match', selector: ':empty', ref: { by: 'id', id: 'element-child' }, iters: 5_000_000 },
      { label: 'empty miss text',        op: 'match', selector: ':empty', ref: { by: 'id', id: 'text-child' },    iters: 5_000_000 },
      { label: 'empty miss whitespace',  op: 'match', selector: ':empty', ref: { by: 'id', id: 'ws-text' },       iters: 5_000_000 },
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
      { label: 'first-child hit',  op: 'match', selector: ':first-child', ref: { by: 'id', id: 'first' },  iters: 5_000_000 },
      { label: 'first-child miss', op: 'match', selector: ':first-child', ref: { by: 'id', id: 'middle' }, iters: 5_000_000 },

      { label: 'last-child hit',   op: 'match', selector: ':last-child',  ref: { by: 'id', id: 'last' },   iters: 5_000_000 },
      { label: 'last-child miss',  op: 'match', selector: ':last-child',  ref: { by: 'id', id: 'middle' }, iters: 5_000_000 },

      { label: 'only-child hit',   op: 'match', selector: ':only-child',  ref: { by: 'id', id: 'only' },   iters: 5_000_000 },
      { label: 'only-child miss',  op: 'match', selector: ':only-child',  ref: { by: 'id', id: 'middle' }, iters: 5_000_000 },

      { label: 'first-child hit2',  op: 'match', selector: ':first-child', ref: { by: 'id', id: 'first' },  iters: 5_000_000 },
      { label: 'first-child miss2', op: 'match', selector: ':first-child', ref: { by: 'id', id: 'middle' }, iters: 5_000_000 },
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
      { label: 'first-of-type hit first',  op: 'match', selector: ':first-of-type', ref: { by: 'id', id: 'i-first' },  iters: 5_000_000 },
      { label: 'first-of-type miss middle', op: 'match', selector: ':first-of-type', ref: { by: 'id', id: 'i-middle' }, iters: 5_000_000 },
      { label: 'first-of-type far miss',   op: 'match', selector: ':first-of-type', ref: { by: 'id', id: 'u-last' },   iters: 5_000_000 },

      { label: 'last-of-type hit last',    op: 'match', selector: ':last-of-type',  ref: { by: 'id', id: 'i-last' },   iters: 5_000_000 },
      { label: 'last-of-type miss middle', op: 'match', selector: ':last-of-type',  ref: { by: 'id', id: 'i-middle' }, iters: 5_000_000 },
      { label: 'last-of-type far miss',    op: 'match', selector: ':last-of-type',  ref: { by: 'id', id: 'u-first' },  iters: 5_000_000 },

      { label: 'only-of-type hit only',    op: 'match', selector: ':only-of-type',  ref: { by: 'id', id: 'span-only' }, iters: 5_000_000 },
      { label: 'only-of-type hit single',  op: 'match', selector: ':only-of-type',  ref: { by: 'id', id: 'em-only' },   iters: 5_000_000 },
      { label: 'only-of-type miss first',  op: 'match', selector: ':only-of-type',  ref: { by: 'id', id: 'i-first' },   iters: 5_000_000 },
      { label: 'only-of-type miss middle', op: 'match', selector: ':only-of-type',  ref: { by: 'id', id: 'i-middle' },  iters: 5_000_000 },
      { label: 'only-of-type far miss',    op: 'match', selector: ':only-of-type',  ref: { by: 'id', id: 'u-first' },   iters: 5_000_000 },
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
      { label: 'nth-child fixed hit',       op: 'match', selector: ':nth-child(3)',       ref: { by: 'id', id: 'n3' },  iters: 5_000_000 },
      { label: 'nth-child fixed miss',      op: 'match', selector: ':nth-child(3)',       ref: { by: 'id', id: 'n4' },  iters: 5_000_000 },
      { label: 'nth-child odd hit',         op: 'match', selector: ':nth-child(odd)',     ref: { by: 'id', id: 'n5' },  iters: 5_000_000 },
      { label: 'nth-child even hit',        op: 'match', selector: ':nth-child(even)',    ref: { by: 'id', id: 'n6' },  iters: 5_000_000 },
      { label: 'nth-child formula hit',     op: 'match', selector: ':nth-child(2n+1)',    ref: { by: 'id', id: 'n5' },  iters: 5_000_000 },
      { label: 'nth-child formula miss',    op: 'match', selector: ':nth-child(2n+1)',    ref: { by: 'id', id: 'n6' },  iters: 5_000_000 },

      { label: 'nth-last-child fixed hit',  op: 'match', selector: ':nth-last-child(2)',  ref: { by: 'id', id: 'n5' },  iters: 5_000_000 },
      { label: 'nth-last-child fixed miss', op: 'match', selector: ':nth-last-child(2)',  ref: { by: 'id', id: 'n4' },  iters: 5_000_000 },

      // nth-of-type / nth-last-of-type count only same localName/namespace siblings.
      { label: 'nth-of-type fixed hit',        op: 'match', selector: ':nth-of-type(2)',       ref: { by: 'id', id: 'i2' }, iters: 5_000_000 },
      { label: 'nth-of-type fixed miss',       op: 'match', selector: ':nth-of-type(2)',       ref: { by: 'id', id: 'i3' }, iters: 5_000_000 },
      { label: 'nth-of-type odd hit',          op: 'match', selector: ':nth-of-type(odd)',     ref: { by: 'id', id: 'i3' }, iters: 5_000_000 },
      { label: 'nth-of-type even hit',         op: 'match', selector: ':nth-of-type(even)',    ref: { by: 'id', id: 'i2' }, iters: 5_000_000 },

      { label: 'nth-last-of-type fixed hit',   op: 'match', selector: ':nth-last-of-type(1)',  ref: { by: 'id', id: 'i3' }, iters: 5_000_000 },
      { label: 'nth-last-of-type fixed miss',  op: 'match', selector: ':nth-last-of-type(1)',  ref: { by: 'id', id: 'i2' }, iters: 5_000_000 },

      // Longer sibling chain, mostly to expose counting/caching cost.{ by: 'id', id:  }
      { label: 'nth-child far fixed hit',      op: 'match', selector: ':nth-child(10)',        ref: { by: 'id', id: 'b10' }, iters: 5_000_000 },
      { label: 'nth-last-child far fixed hit', op: 'match', selector: ':nth-last-child(10)',   ref: { by: 'id', id: 'b1' },  iters: 5_000_000 },
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
      { label: 'match class baseline hit', op: 'match', selector: '.foo', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match class baseline miss', op: 'match', selector: '.foo', ref: { by: 'id', id: 'miss' }, iters: 5_000_000 },

      // :is() single arm
      { label: 'match :is single hit', op: 'match', selector: ':is(.foo)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :is single miss', op: 'match', selector: ':is(.foo)', ref: { by: 'id', id: 'miss' }, iters: 5_000_000 },

      // :is() multi-arm, early hit / late hit / miss
      { label: 'match :is list early hit', op: 'match', selector: ':is(.foo, .nope, [data-x])', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :is list late hit', op: 'match', selector: ':is(.nope, [data-x], .foo)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :is list miss', op: 'match', selector: ':is(.nope, [data-x], #absent)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },

      // :not() simple
      { label: 'match :not simple pass', op: 'match', selector: ':not(.nope)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :not simple reject', op: 'match', selector: ':not(.foo)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },

      // :not() list
      { label: 'match :not list pass', op: 'match', selector: ':not(.nope, [data-x], #absent)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :not list early reject', op: 'match', selector: ':not(.foo, .nope, [data-x])', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
      { label: 'match :not list late reject', op: 'match', selector: ':not(.nope, [data-x], .foo)', ref: { by: 'id', id: 'hit' }, iters: 5_000_000 },
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
      { label: 'match class baseline hit',  op: 'match', selector: '.box', ref: { by: 'id', id: 'hit-desc' },  iters: 1_000_000 },
      { label: 'match class baseline miss', op: 'match', selector: '.nope', ref: { by: 'id', id: 'hit-desc' }, iters: 1_000_000 },

      // Basic :has() combinators
      { label: 'match :has desc hit',     op: 'match', selector: ':has(.target)',    ref: { by: 'id', id: 'hit-desc' },      iters: 1_000_000 },
      { label: 'match :has desc miss',    op: 'match', selector: ':has(.target)',    ref: { by: 'id', id: 'miss-desc' },     iters: 1_000_000 },
      { label: 'match :has child hit',    op: 'match', selector: ':has(> .target)',  ref: { by: 'id', id: 'hit-child' },     iters: 1_000_000 },
      { label: 'match :has child miss',   op: 'match', selector: ':has(> .target)',  ref: { by: 'id', id: 'miss-child' },    iters: 1_000_000 },
      { label: 'match :has next hit',     op: 'match', selector: ':has(+ .target)',  ref: { by: 'id', id: 'hit-adjacent' },  iters: 1_000_000 },
      { label: 'match :has next miss',    op: 'match', selector: ':has(+ .target)',  ref: { by: 'id', id: 'miss-adjacent' }, iters: 1_000_000 },
      { label: 'match :has sibling hit',  op: 'match', selector: ':has(~ .target)',  ref: { by: 'id', id: 'hit-sibling' },   iters: 1_000_000 },
      { label: 'match :has sibling miss', op: 'match', selector: ':has(~ .target)',  ref: { by: 'id', id: 'miss-sibling' },  iters: 1_000_000 },

      // :has() with nth selectors inside the relative selector.
      { label: 'match :has child nth hit',  op: 'match', selector: ':has(> .target:nth-child(2))', ref: { by: 'id', id: 'hit-nth-child' },  iters: 1_000_000 },
      { label: 'match :has child nth miss', op: 'match', selector: ':has(> .target:nth-child(2))', ref: { by: 'id', id: 'miss-nth-child' }, iters: 1_000_000 },
      { label: 'match :has desc nth hit',   op: 'match', selector: ':has(.target:nth-child(2))',   ref: { by: 'id', id: 'hit-nth-desc' },   iters: 1_000_000 },
      { label: 'match :has desc nth miss',  op: 'match', selector: ':has(.target:nth-child(2))',   ref: { by: 'id', id: 'miss-nth-desc' },  iters: 1_000_000 },
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
      { label: 'match baseline id hit', op: 'match', selector: '#lang-inherit-hit', ref: { by: 'id', id: 'lang-inherit-hit' }, iters: 1_000_000 },
      { label: 'match :lang inherited hit', op: 'match', selector: ':lang(en)', ref: { by: 'id', id: 'lang-inherit-hit' }, iters: 1_000_000 },
      { label: 'match :lang inherited miss', op: 'match', selector: ':lang(en)', ref: { by: 'id', id: 'lang-inherit-miss' }, iters: 1_000_000 },

      { label: 'match :dir inherited hit', op: 'match', selector: ':dir(ltr)', ref: { by: 'id', id: 'dir-inherit-hit' }, iters: 1_000_000, maxRatio: 6 },
      { label: 'match :dir inherited miss', op: 'match', selector: ':dir(ltr)', ref: { by: 'id', id: 'dir-inherit-miss' }, iters: 1_000_000 },

      { label: 'match :dir auto ltr hit', op: 'match', selector: ':dir(ltr)', ref: { by: 'id', id: 'dir-auto-ltr' }, iters: 1_000_000 },
      { label: 'match :dir auto rtl hit', op: 'match', selector: ':dir(rtl)', ref: { by: 'id', id: 'dir-auto-rtl' }, iters: 1_000_000 },
      { label: 'match :dir bdi auto rtl hit', op: 'match', selector: ':dir(rtl)', ref: { by: 'id', id: 'bdi-auto-rtl' }, iters: 1_000_000 },
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
      { label: 'match baseline id hit', op: 'match', selector: '#plain', ref: { by: 'id', id: 'plain' }, iters: 5_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', ref: { by: 'id', id: 'plain' }, iters: 5_000_000 },

      // :any-link / :link
      { label: 'match :any-link a hit', op: 'match', selector: ':any-link', ref: { by: 'id', id: 'link-hit' }, iters: 5_000_000 },
      { label: 'match :any-link a miss', op: 'match', selector: ':any-link', ref: { by: 'id', id: 'link-miss' }, iters: 5_000_000 },
      { label: 'match :any-link area hit', op: 'match', selector: ':any-link', ref: { by: 'id', id: 'area-hit' }, iters: 5_000_000 },
      { label: 'match :link a hit', op: 'match', selector: ':link', ref: { by: 'id', id: 'link-hit' }, iters: 5_000_000 },
      { label: 'match :visited false', op: 'match', selector: ':visited', ref: { by: 'id', id: 'link-hit' }, iters: 5_000_000 },

      // :target
      { label: 'match :target hit', op: 'match', selector: ':target', ref: { by: 'id', id: 'target' }, iters: 5_000_000, maxRatio: 10 },
      { label: 'match :target miss', op: 'match', selector: ':target', ref: { by: 'id', id: 'not-target' }, iters: 5_000_000, maxRatio: 10 },

      // :defined
      { label: 'match :defined builtin hit', op: 'match', selector: ':defined', ref: { by: 'id', id: 'defined-div' }, iters: 5_000_000 },
      { label: 'match :defined custom hit', op: 'match', selector: ':defined', ref: { by: 'id', id: 'defined-custom' }, iters: 5_000_000, maxRatio: 10 },
      { label: 'match :defined custom miss', op: 'match', selector: ':defined', ref: { by: 'id', id: 'undefined-custom' }, iters: 5_000_000, maxRatio: 10 },
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
    setupPage: async (page) => {
      await page.locator('#inner').hover();
    },
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#inner', ref: { by: 'id', id: 'inner' }, iters: 5_000_000 },
      { label: 'match :hover self hit', op: 'match', selector: ':hover', ref: { by: 'id', id: 'inner' }, iters: 5_000_000 },
      { label: 'match :hover ancestor hit', op: 'match', selector: ':hover', ref: { by: 'id', id: 'outer' }, iters: 5_000_000 },
      { label: 'match :hover miss', op: 'match', selector: ':hover', ref: { by: 'id', id: 'other' }, iters: 5_000_000 },
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
    setupPage: async (page) => {
      await page.locator('#focus-inner').focus();
      await page.locator('#active-inner').hover();
      await page.mouse.down();
    },
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#active-inner', ref: { by: 'id', id: 'active-inner' }, iters: 5_000_000 },

      { label: 'match :active self hit', op: 'match', selector: ':active', ref: { by: 'id', id: 'active-inner' }, iters: 5_000_000 },
      { label: 'match :active ancestor hit', op: 'match', selector: ':active', ref: { by: 'id', id: 'active-outer' }, iters: 5_000_000 },
      { label: 'match :active miss', op: 'match', selector: ':active', ref: { by: 'id', id: 'active-other' }, iters: 5_000_000 },

      { label: 'match :focus hit', op: 'match', selector: ':focus', ref: { by: 'id', id: 'focus-inner' }, iters: 5_000_000, maxRatio: 7 },
      { label: 'match :focus miss', op: 'match', selector: ':focus', ref: { by: 'id', id: 'focus-other' }, iters: 5_000_000 },
      { label: 'match :focus-visible hit', op: 'match', selector: ':focus-visible', ref: { by: 'id', id: 'focus-inner' }, iters: 5_000_000, maxRatio: 7 },

      { label: 'match :focus-within self hit', op: 'match', selector: ':focus-within', ref: { by: 'id', id: 'focus-inner' }, iters: 5_000_000 },
      { label: 'match :focus-within ancestor hit', op: 'match', selector: ':focus-within', ref: { by: 'id', id: 'focus-outer' }, iters: 5_000_000 },
      { label: 'match :focus-within miss', op: 'match', selector: ':focus-within', ref: { by: 'id', id: 'focus-other' }, iters: 5_000_000 },
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
      { label: 'match baseline id hit', op: 'match', selector: '#enabled-input', ref: { by: 'id', id: 'enabled-input' }, iters: 1_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', ref: { by: 'id', id: 'enabled-input' }, iters: 1_000_000 },

      // :enabled / :disabled
      { label: 'match :enabled hit', op: 'match', selector: ':enabled', ref: { by: 'id', id: 'enabled-input' }, iters: 1_000_000, maxRatio: 14 },
      { label: 'match :enabled miss disabled', op: 'match', selector: ':enabled', ref: { by: 'id', id: 'disabled-input' }, iters: 1_000_000 },
      { label: 'match :disabled direct hit', op: 'match', selector: ':disabled', ref: { by: 'id', id: 'disabled-input' }, iters: 1_000_000 },
      { label: 'match :disabled fieldset hit', op: 'match', selector: ':disabled', ref: { by: 'id', id: 'fieldset-disabled-input' }, iters: 1_000_000 },
      { label: 'match :disabled miss', op: 'match', selector: ':disabled', ref: { by: 'id', id: 'enabled-input' }, iters: 1_000_000, maxRatio: 14 },

      // :read-only / :read-write
      { label: 'match :read-only readonly hit', op: 'match', selector: ':read-only', ref: { by: 'id', id: 'readonly-input' }, iters: 1_000_000 },
      { label: 'match :read-only plain hit', op: 'match', selector: ':read-only', ref: { by: 'id', id: 'plain' }, iters: 1_000_000, maxRatio: 17 },
      { label: 'match :read-write input hit', op: 'match', selector: ':read-write', ref: { by: 'id', id: 'readwrite-input' }, iters: 1_000_000, maxRatio: 14  },
      { label: 'match :read-write editable hit', op: 'match', selector: ':read-write', ref: { by: 'id', id: 'editable' }, iters: 1_000_000 },
      { label: 'match :read-write readonly miss', op: 'match', selector: ':read-write', ref: { by: 'id', id: 'readonly-input' }, iters: 1_000_000 },

      // :placeholder-shown
      { label: 'match :placeholder-shown hit', op: 'match', selector: ':placeholder-shown', ref: { by: 'id', id: 'placeholder-empty' }, iters: 1_000_000 },
      { label: 'match :placeholder-shown miss filled', op: 'match', selector: ':placeholder-shown', ref: { by: 'id', id: 'placeholder-filled' }, iters: 1_000_000 },
      { label: 'match :placeholder-shown miss plain', op: 'match', selector: ':placeholder-shown', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },

      // :default
      { label: 'match :default checked hit', op: 'match', selector: ':default', ref: { by: 'id', id: 'default-checked' }, iters: 1_000_000 },
      { label: 'match :default checkbox miss', op: 'match', selector: ':default', ref: { by: 'id', id: 'not-default-checked' }, iters: 1_000_000 },
      { label: 'match :default option hit', op: 'match', selector: ':default', ref: { by: 'id', id: 'default-option' }, iters: 1_000_000 },
      { label: 'match :default option miss', op: 'match', selector: ':default', ref: { by: 'id', id: 'not-default-option' }, iters: 1_000_000 },
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
      { label: 'match baseline id hit', op: 'match', selector: '#checked-box', ref: { by: 'id', id: 'checked-box' }, iters: 1_000_000 },
      { label: 'match baseline id miss', op: 'match', selector: '#absent', ref: { by: 'id', id: 'checked-box' }, iters: 1_000_000 },

      // :checked
      { label: 'match :checked checkbox hit', op: 'match', selector: ':checked', ref: { by: 'id', id: 'checked-box' }, iters: 1_000_000 },
      { label: 'match :checked checkbox miss', op: 'match', selector: ':checked', ref: { by: 'id', id: 'unchecked-box' }, iters: 1_000_000 },
      { label: 'match :checked radio hit', op: 'match', selector: ':checked', ref: { by: 'id', id: 'checked-radio' }, iters: 1_000_000 },
      { label: 'match :checked radio miss', op: 'match', selector: ':checked', ref: { by: 'id', id: 'unchecked-radio' }, iters: 1_000_000 },
      { label: 'match :checked option hit', op: 'match', selector: ':checked', ref: { by: 'id', id:  'selected-option' }, iters: 1_000_000 },
      { label: 'match :checked option miss', op: 'match', selector: ':checked', ref: { by: 'id', id: 'unselected-option' }, iters: 1_000_000 },

      // :indeterminate
      { label: 'match :indeterminate checkbox hit', op: 'match', selector: ':indeterminate', ref: { by: 'id', id: 'checkbox-indeterminate' }, iters: 1_000_000 },
      { label: 'match :indeterminate checkbox miss', op: 'match', selector: ':indeterminate', ref: { by: 'id', id: 'unchecked-box' }, iters: 1_000_000 },
      { label: 'match :indeterminate progress hit', op: 'match', selector: ':indeterminate', ref: { by: 'id', id: 'progress-indeterminate' }, iters: 1_000_000 },
      { label: 'match :indeterminate progress miss', op: 'match', selector: ':indeterminate', ref: { by: 'id', id: 'progress-determinate' }, iters: 1_000_000 },

      // :required / :optional
      { label: 'match :required hit', op: 'match', selector: ':required', ref: { by: 'id', id: 'required-empty' }, iters: 1_000_000 },
      { label: 'match :required miss optional', op: 'match', selector: ':required', ref: { by: 'id', id: 'optional-empty' }, iters: 1_000_000 },
      { label: 'match :required miss plain', op: 'match', selector: ':required', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },
      { label: 'match :optional hit', op: 'match', selector: ':optional', ref: { by: 'id', id: 'optional-empty' }, iters: 1_000_000 },
      { label: 'match :optional miss required', op: 'match', selector: ':optional', ref: { by: 'id', id: 'required-empty' }, iters: 1_000_000 },
      { label: 'match :optional miss plain', op: 'match', selector: ':optional', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },

      // :valid / :invalid
      { label: 'match :valid required filled hit', op: 'match', selector: ':valid', ref: { by: 'id', id: 'required-filled' }, iters: 1_000_000 },
      { label: 'match :valid email hit', op: 'match', selector: ':valid', ref: { by: 'id', id: 'email-valid' }, iters: 1_000_000 },
      { label: 'match :valid email miss', op: 'match', selector: ':valid', ref: { by: 'id', id: 'email-invalid' }, iters: 1_000_000, maxRatio: 10 },
      { label: 'match :valid plain miss', op: 'match', selector: ':valid', ref: { by: 'id', id:  'plain' }, iters: 1_000_000 },
      { label: 'match :invalid required empty hit', op: 'match', selector: ':invalid', ref: { by: 'id', id: 'required-empty' }, iters: 1_000_000, maxRatio: 12 },
      { label: 'match :invalid email hit', op: 'match', selector: ':invalid', ref: { by: 'id', id: 'email-invalid' }, iters: 1_000_000, maxRatio: 13 },
      { label: 'match :invalid email miss', op: 'match', selector: ':invalid', ref: { by: 'id', id: 'email-valid' }, iters: 1_000_000 },
      { label: 'match :invalid plain miss', op: 'match', selector: ':invalid', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },

      // :in-range / :out-of-range
      { label: 'match :in-range hit', op: 'match', selector: ':in-range', ref: { by: 'id', id: 'range-in' }, iters: 1_000_000 },
      { label: 'match :in-range miss under', op: 'match', selector: ':in-range', ref: { by: 'id', id: 'range-under' }, iters: 1_000_000 },
      { label: 'match :in-range miss empty', op: 'match', selector: ':in-range', ref: { by: 'id', id: 'range-empty' }, iters: 1_000_000 },
      { label: 'match :in-range miss plain', op: 'match', selector: ':in-range', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },
      { label: 'match :out-of-range under hit', op: 'match', selector: ':out-of-range', ref: { by: 'id', id: 'range-under' }, iters: 1_000_000 },
      { label: 'match :out-of-range over hit', op: 'match', selector: ':out-of-range', ref: { by: 'id', id: 'range-over' }, iters: 1_000_000 },
      { label: 'match :out-of-range miss in', op: 'match', selector: ':out-of-range', ref: { by: 'id', id: 'range-in' }, iters: 1_000_000 },
      { label: 'match :out-of-range miss empty', op: 'match', selector: ':out-of-range', ref: { by: 'id', id: 'range-empty' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'match resource state pseudo classes',
    // status: 'only',
    browsers: ['webkit'],
    engines: ['native', 'selectlet'],
    quickIters: 200_000,
    markup: `
      <video id="video"></video>
      <audio id="audio" muted></audio>
      <div id="plain"></div>
    `,
    probeKeys: ['match'],
    benches: [
      { label: 'match baseline id hit', op: 'match', selector: '#video', ref: { by: 'id', id: 'video' }, iters: 1_000_000 },

      { label: 'match :muted hit', op: 'match', selector: ':muted', ref: { by: 'id', id: 'audio' }, iters: 1_000_000 },
      { label: 'match :muted miss media', op: 'match', selector: ':muted', ref: { by: 'id', id: 'video' }, iters: 1_000_000 },
      { label: 'match :muted miss plain', op: 'match', selector: ':muted', ref: { by: 'id', id: 'plain' }, iters: 1_000_000 },

      { label: 'match :paused media', op: 'match', selector: ':paused', ref: { by: 'id', id: 'video' }, iters: 1_000_000 },
      { label: 'match :playing miss media', op: 'match', selector: ':playing', ref: { by: 'id', id: 'video' }, iters: 1_000_000 },
      { label: 'match :seeking miss media', op: 'match', selector: ':seeking', ref: { by: 'id', id: 'video' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'select id candidate paths 1 / document.all',
    status: 'skip',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
        sxlt.snapshot.hasDocumentAll = true;
        sxlt.snapshot.hasTreeWalker = true;
      });
    },
    probeKeys: ['select'],
    benches: [
      { label: 'select id hit document', op: 'select', selector: '#item-100', iters: 100_000 },
      { label: 'select id miss document', op: 'select', selector: '#absent', iters: 100_000 },
      { label: 'select id plus class document', op: 'select', selector: '#item-100.item', iters: 100_000 },
      { label: 'select id hit element', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id miss element', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select context id element', op: 'select', selector: '#root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id hit detached', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id miss detached', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id hit fragment', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'select id miss fragment', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'select id candidate paths 2 / mutation fallback',
    status: 'skip',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: true });
        sxlt.snapshot.hasDocumentAll = false;
        sxlt.snapshot.hasTreeWalker = true;
      });
    },
    probeKeys: ['select'],
    benches: [
      { label: 'select id hit document', op: 'select', selector: '#item-100', iters: 100_000 },
      { label: 'select id miss document', op: 'select', selector: '#absent', iters: 100_000 },
      { label: 'select id plus class document', op: 'select', selector: '#item-100.item', iters: 100_000 },
      { label: 'select id hit element', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id miss element', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select context id element', op: 'select', selector: '#root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id hit detached', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id miss detached', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id hit fragment', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'select id miss fragment', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'select id candidate paths 3 / treewalker fallback',
    status: 'skip',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
        sxlt.snapshot.hasDocumentAll = false;
        sxlt.snapshot.hasTreeWalker = true;
      });
    },
    probeKeys: ['select'],
    benches: [
      { label: 'select id hit document', op: 'select', selector: '#item-100', iters: 100_000 },
      { label: 'select id miss document', op: 'select', selector: '#absent', iters: 100_000 },
      { label: 'select id plus class document', op: 'select', selector: '#item-100.item', iters: 100_000 },
      { label: 'select id hit element', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id miss element', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select context id element', op: 'select', selector: '#root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id hit detached', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id miss detached', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id hit fragment', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'select id miss fragment', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'select id candidate paths 4 / manual walk fallback',
    status: 'skip',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
        sxlt.snapshot.hasDocumentAll = false;
        sxlt.snapshot.hasTreeWalker = false;
      });
    },
    probeKeys: ['select'],
    benches: [
      { label: 'select id hit document', op: 'select', selector: '#item-100', iters: 100_000 },
      { label: 'select id miss document', op: 'select', selector: '#absent', iters: 100_000 },
      { label: 'select id plus class document', op: 'select', selector: '#item-100.item', iters: 100_000 },
      { label: 'select id hit element', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id miss element', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select context id element', op: 'select', selector: '#root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id hit detached', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id miss detached', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id hit fragment', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'select id miss fragment', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'select id candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 3_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: true });

        // sxlt.configure({ MUTATE_IDS: false });
        // sxlt.snapshot.hasDocumentAll = false;
        // sxlt.snapshot.hasTreeWalker = false;
      });
    },
    probeKeys: ['select'],
    benches: [
      // document context: document.all fast path
      { label: 'select id hit document', op: 'select', selector: '#item-100', iters: 100_000 },
      { label: 'select id miss document', op: 'select', selector: '#absent', iters: 100_000 },

      // compound ID selector remains a separate hotspot
      { label: 'select id plus class document', op: 'select', selector: '#item-100.item', iters: 100_000 },

      // connected element context: ownerDocument.all + containment filter
      { label: 'select id hit element', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select id miss element', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'select context id element', op: 'select', selector: '#root', ref: { by: 'id', id: 'root' }, iters: 100_000 },

      // detached element context: traversal fallback
      { label: 'select id hit detached', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'select id miss detached', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },

      // fragment context: mutation path when enabled, traversal otherwise
      { label: 'select id hit fragment', op: 'select', selector: '#item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'select id miss fragment', op: 'select', selector: '#absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'byId candidate paths 1 / document.all',
    status: 'skip',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
        sxlt.snapshot.hasDocumentAll = true;
      });
    },
    probeKeys: [''],
    benches: [
      { label: 'byId hit document', op: 'byId', id: 'item-100', iters: 100_000 },
      { label: 'byId miss document', op: 'byId', id: 'absent', iters: 100_000 },
      { label: 'byId hit element', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId miss element', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId context id element', op: 'byId', id: 'root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId hit detached', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId miss detached', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId hit fragment', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'byId miss fragment', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'byId candidate paths 2 / mutation fallback',
    status: 'skip',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: true });
        sxlt.snapshot.hasDocumentAll = false;
      });
    },
    probeKeys: [''],
    benches: [
      { label: 'byId hit document', op: 'byId', id: 'item-100', iters: 100_000 },
      { label: 'byId miss document', op: 'byId', id: 'absent', iters: 100_000 },
      { label: 'byId hit element', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId miss element', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId context id element', op: 'byId', id: 'root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId hit detached', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId miss detached', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId hit fragment', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'byId miss fragment', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'byId candidate paths 3 / manual walk fallback',
    status: 'skip',
    browsers: ['chromium'],
    quickIters: 20_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
        sxlt.snapshot.hasDocumentAll = false;
      });
    },
    probeKeys: [''],
    benches: [
      { label: 'byId hit document', op: 'byId', id: 'item-100', iters: 100_000 },
      { label: 'byId miss document', op: 'byId', id: 'absent', iters: 100_000 },
      { label: 'byId hit element', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId miss element', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId context id element', op: 'byId', id: 'root', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId hit detached', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId miss detached', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId hit fragment', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'byId miss fragment', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'byId candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    quickIters: 3_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = globalThis.selectlet;
        if (!sxlt?.snapshot) return;
        sxlt.configure({ MUTATE_IDS: false });
      });
    },
    probeKeys: [''],
    benches: [
      // document context: native getElementById / selectlet document path
      { label: 'byId hit document', op: 'byId', id: 'item-100', iters: 100_000 },
      { label: 'byId miss document', op: 'byId', id: 'absent', iters: 100_000 },

      // connected element context: native selector approximation / selectlet scoped byId
      { label: 'byId hit element', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId miss element', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root' }, iters: 100_000 },
      { label: 'byId context id element', op: 'byId', id: 'root', ref: { by: 'id', id: 'root' }, iters: 100_000 },

      // detached element context: traversal fallback
      { label: 'byId hit detached', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },
      { label: 'byId miss detached', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 20_000 },

      // fragment context: getElementById/native fallback vs selectlet fragment path
      { label: 'byId hit fragment', op: 'byId', id: 'item-100', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
      { label: 'byId miss fragment', op: 'byId', id: 'absent', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 20_000 },
    ],
  },

  {
    name: 'select basic selector families',
    // status: 'only',
    // browsers: ['firefox'],
    browsers: ['chromium'],
    quickIters: 1_000,
    markup: `
      <main id="root">
        ${Array.from({ length: 200 }, (_, i) => `
          <section class="group ${i % 2 ? 'odd' : 'even'}" data-group="${i}">
            <div id="item-${i}" class="item ${i % 3 ? 'cold' : 'hot'}" data-kind="${i % 4 ? 'normal' : 'special'}">
              <span class="label">label ${i}</span>
            </div>
          </section>
        `).join('')}
      </main>
    `,
    probeKeys: ['select'],
    benches: [
      // Baselines / optimizer seed families
      { label: 'select id hit',        op: 'select', selector: '#item-100',      iters: 100_000 },
      { label: 'select id miss',       op: 'select', selector: '#absent',        iters: 100_000 },
      { label: 'select class many',    op: 'select', selector: '.item',          iters: 50_000 },
      { label: 'select class subset',  op: 'select', selector: '.hot',           iters: 50_000 },
      { label: 'select tag many',      op: 'select', selector: 'div',            iters: 50_000 },
      { label: 'select tag nested',    op: 'select', selector: 'span',           iters: 50_000 },

      // Attribute path / likely non-seed or less optimized path
      { label: 'select attr exists',   op: 'select', selector: '[data-kind]',              iters: 20_000 },
      { label: 'select attr exact',    op: 'select', selector: '[data-kind="special"]',    iters: 20_000 },
      { label: 'select attr contains', op: 'select', selector: '[data-group*="1"]',        iters: 20_000 },

      // Combined seed + filter
      { label: 'select id plus class hit',    op: 'select', selector: '#item-100.item',              iters: 100_000 },
      { label: 'select class plus attr',      op: 'select', selector: '.item[data-kind="special"]',  iters: 20_000 },
      { label: 'select tag plus class',       op: 'select', selector: 'div.item',                    iters: 50_000 },

      // Descendant combinator: candidate seed plus ancestry/filtering
      { label: 'select descendant class',     op: 'select', selector: 'section .label',              iters: 20_000 },
      { label: 'select descendant attr',      op: 'select', selector: 'section [data-kind="special"]', iters: 20_000 },
    ],
  },

  {
    name: 'select grouped id sort/dedupe',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="a"></div><div id="b"></div><div id="c"></div><div id="d"></div><div id="e"></div>
    `,
    probeKeys: ['select'],
    quickIters: 20_000,
    benches: [
      { label: 'select grouped ids sort dedupe', op: 'select', selector: '#e, #a, #d, #b, #a, #c, #e, #b', iters: 200_000 },
      { label: 'select grouped ids sort no dedupe', op: 'select', selector: '#e, #d, #b, #a, #c', iters: 200_000 },
    ],
  },

  {
    name: 'select grouped id sort no dedupe',
    // status: 'only',
    browsers: ['chromium'],
    markup: idMarkup(80),
    probeKeys: ['select'],
    quickIters: 2_000,
    benches: [
      { label: 'grouped ids sort 4',  op: 'select', selector: groupedIds(4),  iters: 1_000_000 },
      { label: 'grouped ids sort 8',  op: 'select', selector: groupedIds(8),  iters: 1_000_000 },
      { label: 'grouped ids sort 12', op: 'select', selector: groupedIds(12), iters: 700_000 },
      { label: 'grouped ids sort 16', op: 'select', selector: groupedIds(16), iters: 500_000 },
      { label: 'grouped ids sort 24', op: 'select', selector: groupedIds(24), iters: 300_000 },
      { label: 'grouped ids sort 32', op: 'select', selector: groupedIds(32), iters: 200_000 },
      { label: 'grouped ids sort 48', op: 'select', selector: groupedIds(48), iters: 100_000 },
      { label: 'grouped ids sort 64', op: 'select', selector: groupedIds(64), iters: 75_000 },
    ],
  },

  {
    name: 'select grouped id sort dedupe',
    // status: 'only',
    browsers: ['chromium'],
    markup: idMarkup(80),
    probeKeys: ['select'],
    quickIters: 1_000,
    benches: [
      { label: 'grouped ids sort dedupe 4',  op: 'select', selector: groupedDupedIds(4),  iters: 1_000_000 },
      { label: 'grouped ids sort dedupe 8',  op: 'select', selector: groupedDupedIds(8),  iters: 1_000_000 },
      { label: 'grouped ids sort dedupe 12', op: 'select', selector: groupedDupedIds(12), iters: 700_000 },
      { label: 'grouped ids sort dedupe 16', op: 'select', selector: groupedDupedIds(16), iters: 500_000 },
      { label: 'grouped ids sort dedupe 24', op: 'select', selector: groupedDupedIds(24), iters: 300_000 },
      { label: 'grouped ids sort dedupe 32', op: 'select', selector: groupedDupedIds(32), iters: 200_000 },
      { label: 'grouped ids sort dedupe 48', op: 'select', selector: groupedDupedIds(48), iters: 100_000 },
      { label: 'grouped ids sort dedupe 64', op: 'select', selector: groupedDupedIds(64), iters: 75_000 },
    ],
  },

  {
    name: 'select class candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <section id="root">
        <div id="a" class="hit foo"><span id="aa" class="foo"></span></div>
        <div id="b" class="foo"></div>
        <div id="c" class="bar"></div>
        <div id="d" class="hit"></div>
      </section>
    `,
    quickIters: 20_000,
    probeKeys: ['select'],
    benches: [
      { label: 'select class hit document',    op: 'select', selector: '.hit',     iters: 1_000_000 },
      { label: 'select class miss document',   op: 'select', selector: '.missing', iters: 1_000_000 },
      { label: 'select class hit element',     op: 'select', selector: '.hit',     ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'select class miss element',    op: 'select', selector: '.missing', ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'select class hit detached',    op: 'select', selector: '.foo',     ref: { by: 'id', id: 'root', home: 'detached' },  iters: 1_000_000 },
      { label: 'select class miss detached',   op: 'select', selector: '.missing', ref: { by: 'id', id: 'root', home: 'detached' },  iters: 1_000_000 },
      { label: 'select class hit fragment',    op: 'select', selector: '.foo',     ref: { by: 'id', id: 'root', home: 'fragment' },  iters: 1_000_000 },
      { label: 'select class miss fragment',   op: 'select', selector: '.missing', ref: { by: 'id', id: 'root', home: 'fragment' },  iters: 1_000_000 },
      { label: 'select context class element', op: 'select', selector: '.foo',     ref: { by: 'id', id: 'a' },    iters: 1_000_000 },
    ],
  },

  {
    name: 'byClass candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <section id="root">
        <div id="a" class="hit foo"><span id="aa" class="foo"></span></div>
        <div id="b" class="foo"></div>
        <div id="c" class="bar"></div>
        <div id="d" class="hit"></div>
      </section>
    `,
    probeKeys: ['byClass'],
    quickIters: 20_000,
    benches: [
      { label: 'byClass hit document',    op: 'byClass', cls: 'hit',     iters: 1_000_000 },
      { label: 'byClass miss document',   op: 'byClass', cls: 'missing', iters: 1_000_000 },
      { label: 'byClass hit element',     op: 'byClass', cls: 'hit',     ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byClass miss element',    op: 'byClass', cls: 'missing', ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byClass hit detached',    op: 'byClass', cls: 'hit',     ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'byClass miss detached',   op: 'byClass', cls: 'missing', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'byClass hit fragment',    op: 'byClass', cls: 'hit',     ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byClass miss fragment',   op: 'byClass', cls: 'missing', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byClass context element', op: 'byClass', cls: 'foo',     ref: { by: 'id', id: 'a' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'byTag candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <section id="root">
        <div id="a"><span id="aa"></span></div>
        <div id="b"></div>
        <p id="c"></p>
        <div id="d"></div>
      </section>
    `,
    probeKeys: ['byTag'],
    quickIters: 20_000,
    benches: [
      { label: 'byTag hit document',    op: 'byTag', tag: 'div',     iters: 1_000_000 },
      { label: 'byTag miss document',   op: 'byTag', tag: 'article', iters: 1_000_000 },
      { label: 'byTag hit element',     op: 'byTag', tag: 'div',     ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byTag miss element',    op: 'byTag', tag: 'article', ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byTag hit detached',    op: 'byTag', tag: 'div',     ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'byTag miss detached',   op: 'byTag', tag: 'article', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'byTag hit fragment',    op: 'byTag', tag: 'div',     ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byTag miss fragment',   op: 'byTag', tag: 'article', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byTag context element', op: 'byTag', tag: 'span',    ref: { by: 'id', id: 'a' }, iters: 1_000_000 },
      { label: 'byTag universal tag',   op: 'byTag', tag: '*',       ref: { by: 'id', id: 'a' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'byTag fragment root case paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <template id="tpl">
        ${Array.from({ length: 32 }, (_, i) => `<div id="d${i}"><span></span></div>`).join('')}
        ${Array.from({ length: 32 }, (_, i) => `<p id="p${i}"></p>`).join('')}
      </template>
    `,
    probeKeys: ['byTag'],
    quickIters: 10_000,
    benches: [
      { label: 'byTag fragment roots div',          op: 'byTag', tag: 'div',     ref: { by: 'template', id: 'tpl' }, iters: 500_000 },
      { label: 'byTag fragment roots DIV',          op: 'byTag', tag: 'DIV',     ref: { by: 'template', id: 'tpl' }, iters: 500_000 },
      { label: 'byTag fragment roots p',            op: 'byTag', tag: 'p',       ref: { by: 'template', id: 'tpl' }, iters: 500_000 },
      { label: 'byTag fragment roots P',            op: 'byTag', tag: 'P',       ref: { by: 'template', id: 'tpl' }, iters: 500_000 },
      { label: 'byTag fragment roots article miss', op: 'byTag', tag: 'article', ref: { by: 'template', id: 'tpl' }, iters: 500_000, maxRatio: 12 },
    ],
  },

  {
    name: 'select tag candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <section id="root">
        <div id="a"><span id="aa"></span></div>
        <div id="b"></div>
        <p id="c"></p>
        <div id="d"></div>
      </section>
    `,
    probeKeys: ['select'],
    quickIters: 20_000,
    benches: [
      { label: 'select tag hit document',    op: 'select', selector: 'div',     iters: 1_000_000 },
      { label: 'select tag miss document',   op: 'select', selector: 'article', iters: 1_000_000 },
      { label: 'select tag hit element',     op: 'select', selector: 'div',     ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'select tag miss element',    op: 'select', selector: 'article', ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'select tag hit detached',    op: 'select', selector: 'div',     ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'select tag miss detached',   op: 'select', selector: 'article', ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'select tag hit fragment',    op: 'select', selector: 'div',     ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'select tag miss fragment',   op: 'select', selector: 'article', ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'select context tag element', op: 'select', selector: 'span',    ref: { by: 'id', id: 'a' }, iters: 1_000_000 },
      { label: 'select universal tag',       op: 'select', selector: '*',       ref: { by: 'id', id: 'a' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'select tag html standard paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: htmlStandard,
    probeKeys: ['select'],
    quickIters: 200,
    benches: [
      { label: 'select htmlstandard div',      op: 'select', selector: 'div',      iters: 20_000 },
      { label: 'select htmlstandard p',        op: 'select', selector: 'p',        iters: 20_000 },
      { label: 'select htmlstandard a',        op: 'select', selector: 'a',        iters: 20_000 },
      { label: 'select htmlstandard code',     op: 'select', selector: 'code',     iters: 20_000 },
      { label: 'select htmlstandard section',  op: 'select', selector: 'section',  iters: 20_000 },
      { label: 'select htmlstandard h2',       op: 'select', selector: 'h2',       iters: 20_000 },
      { label: 'select htmlstandard article',  op: 'select', selector: 'article',  iters: 20_000 },
      { label: 'select htmlstandard madeup',   op: 'select', selector: 'madeup',   iters: 20_000 },
      { label: 'select htmlstandard universal', op: 'select', selector: '*',       iters: 5_000 },
    ],
  },

  {
    name: 'select tag upper html standard paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: htmlStandard,
    probeKeys: ['select'],
    quickIters: 300,
    benches: [
      { label: 'select htmlstandard upper DIV',     op: 'select', selector: 'DIV',      iters: 20_000 },
      { label: 'select htmlstandard upper P',       op: 'select', selector: 'P',        iters: 20_000 },
      { label: 'select htmlstandard upper A',       op: 'select', selector: 'A',        iters: 20_000 },
      { label: 'select htmlstandard upper Code',    op: 'select', selector: 'Code',     iters: 20_000 },
      { label: 'select htmlstandard upper Section', op: 'select', selector: 'Section',  iters: 20_000 },
      { label: 'select htmlstandard upper H2',      op: 'select', selector: 'H2',       iters: 20_000 },
      { label: 'select htmlstandard upper Article', op: 'select', selector: 'Article',  iters: 20_000 },
      { label: 'select htmlstandard upper Madeup',  op: 'select', selector: 'Madeup',   iters: 20_000 },
    ],
  },

  {
    name: 'select tag template fragment paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <template id="tmpl">
        <div id="d1"><p id="p1"><a id="a1"></a><code id="c1"></code></p></div>
        <section id="s1"><h2 id="h1"></h2><p id="p2"><code id="c2"></code></p></section>
        <article id="ar1"><p id="p3"><a id="a2"></a></p></article>
        <div id="d2"><span id="sp1"></span><p id="p4"></p></div>
        <FÖÖd id="upper-o-food"></FÖÖd>
        <fööd id="lower-o-food"></fööd>
      </template>
    `,
    probeKeys: ['select'],
    quickIters: 20_000,
    benches: [
      { label: 'select fragment div',       op: 'select', selector: 'div',     ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment p',         op: 'select', selector: 'p',       ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment a',         op: 'select', selector: 'a',       ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment code',      op: 'select', selector: 'code',    ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment section',   op: 'select', selector: 'section', ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment madeup',    op: 'select', selector: 'madeup',  ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000, maxRatio: 6 },
      { label: 'select fragment upper DIV', op: 'select', selector: 'DIV',     ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000, maxRatio: 6 },
      { label: 'select fragment upper P',   op: 'select', selector: 'P',       ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000 },
      { label: 'select fragment food ASCII', op: 'select', selector: 'FÖÖD',    ref: { by: 'template', id: 'tmpl' }, iters: 1_000_000, maxRatio: 8 },
      { label: 'select fragment universal', op: 'select', selector: '*',       ref: { by: 'template', id: 'tmpl' }, iters: 500_000 },
    ],
  },

  {
    name: 'select tag deep template fragment paths',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <template id="deep-tmpl">
        <div id="r0">
          ${'<section><div><p><a><code><span>'.repeat(24)}
          <h2 id="deep-h2"></h2>
          <p id="deep-p"></p>
          <a id="deep-a"></a>
          <code id="deep-code"></code>
          ${'</span></code></a></p></div></section>'.repeat(24)}
        </div>
        <article id="r1">
          ${'<div><section><p><span><code>'.repeat(24)}
          <div id="deep-div"></div>
          <p id="deep-p2"></p>
          <a id="deep-a2"></a>
          ${'</code></span></p></section></div>'.repeat(24)}
        </article>
        <FÖÖd id="upper-o-food"></FÖÖd>
        <fööd id="lower-o-food"></fööd>
      </template>
    `,
    probeKeys: ['select'],
    quickIters: 4_000,
    benches: [
      { label: 'select deep fragment div',        op: 'select', selector: 'div',     ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment p',          op: 'select', selector: 'p',       ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment a',          op: 'select', selector: 'a',       ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment code',       op: 'select', selector: 'code',    ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment section',    op: 'select', selector: 'section', ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment h2',         op: 'select', selector: 'h2',      ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment madeup',     op: 'select', selector: 'madeup',  ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment upper DIV',  op: 'select', selector: 'DIV',     ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment upper P',    op: 'select', selector: 'P',       ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment food ASCII', op: 'select', selector: 'FÖÖD',    ref: { by: 'template', id: 'deep-tmpl' }, iters: 200_000 },
      { label: 'select deep fragment universal',  op: 'select', selector: '*',       ref: { by: 'template', id: 'deep-tmpl' }, iters: 100_000 },
    ],
  },

  {
    name: 'byTagNs candidate paths',
    // status: 'only',
    browsers: ['chromium'],
    engines: ['native', 'selectlet'],
    markup: `
      <section id="root">
        <div id="a"><span id="aa"></span></div>
        <svg id="svg" viewBox="0 0 10 10">
          <circle id="circle"></circle>
          <foreignObject id="fo"><div id="svg-html"></div></foreignObject>
        </svg>
        <p id="p"></p>
      </section>
    `,
    probeKeys: ['byTagNs'],
    quickIters: 20_000,
    benches: [
      { label: 'byTagNs any div document',       op: 'byTagNs', byTagNs: { ns: '*', local: 'div' },     iters: 1_000_000 },
      { label: 'byTagNs html div document',      op: 'byTagNs', byTagNs: { ns: 'http://www.w3.org/1999/xhtml', local: 'div' }, iters: 1_000_000 },
      { label: 'byTagNs svg circle document',    op: 'byTagNs', byTagNs: { ns: 'http://www.w3.org/2000/svg', local: 'circle' }, iters: 1_000_000 },
      { label: 'byTagNs any miss document',      op: 'byTagNs', byTagNs: { ns: '*', local: 'madeup' },  iters: 1_000_000 },

      { label: 'byTagNs any div element',        op: 'byTagNs', byTagNs: { ns: '*', local: 'div' },     ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byTagNs svg circle element',     op: 'byTagNs', byTagNs: { ns: 'http://www.w3.org/2000/svg', local: 'circle' }, ref: { by: 'id', id: 'root' }, iters: 1_000_000 },
      { label: 'byTagNs any miss element',       op: 'byTagNs', byTagNs: { ns: '*', local: 'madeup' },  ref: { by: 'id', id: 'root' }, iters: 1_000_000 },

      { label: 'byTagNs any div detached',       op: 'byTagNs', byTagNs: { ns: '*', local: 'div' },     ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },
      { label: 'byTagNs any miss detached',      op: 'byTagNs', byTagNs: { ns: '*', local: 'madeup' },  ref: { by: 'id', id: 'root', home: 'detached' }, iters: 1_000_000 },

      { label: 'byTagNs any div fragment',       op: 'byTagNs', byTagNs: { ns: '*', local: 'div' },     ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byTagNs svg circle fragment',    op: 'byTagNs', byTagNs: { ns: 'http://www.w3.org/2000/svg', local: 'circle' }, ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
      { label: 'byTagNs any miss fragment',      op: 'byTagNs', byTagNs: { ns: '*', local: 'madeup' },  ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },

      { label: 'byTagNs universal document',     op: 'byTagNs', byTagNs: { ns: '*', local: '*' },       iters: 1_000_000 },
      { label: 'byTagNs universal fragment',     op: 'byTagNs', byTagNs: { ns: '*', local: '*' },       ref: { by: 'id', id: 'root', home: 'fragment' }, iters: 1_000_000 },
    ],
  },

  {
    name: 'select fragment class cache',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="host">
        <div class="foo"></div>
        <div class="bar"></div>
        <div class="foo"></div>
      </div>
    `,
    probeKeys: ['select'],
    quickIters: 20_000,
    benches: [
      { op: 'select', selector: '.foo', ref: { by: 'id', id: 'host', home: 'fragment' }, iters: 5_000_000 },
      { op: 'select', selector: '.nope', ref: { by: 'id', id: 'host', home: 'fragment' }, iters: 5_000_000 },
      { op: 'byClass', cls: 'foo', ref: { by: 'id', id: 'host', home: 'fragment' }, iters: 5_000_000 },
    ],
  },

  {
    name: 'match cached simple selectors',
    // status: 'only',
    browsers: ['chromium'],
    markup: `
      <div id="target" class="foo bar" data-x="value"></div>
    `,
    probeKeys: ['match'],
    quickIters: 20_000,
    benches: [
      { op: 'match', selector: '#target',          ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { op: 'match', selector: '.foo',             ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { op: 'match', selector: '.nope',            ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { op: 'match', selector: 'div',              ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { op: 'match', selector: '[data-x]',         ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
      { op: 'match', selector: '[data-x="value"]', ref: { by: 'id', id: 'target' }, iters: 5_000_000 },
    ],
  },

  {
    name: 'match hot cold simple selectors',
    // status: 'only',
    browsers: ['chromium'],
    markup: `<div id="target" class="foo bar" data-x="value"></div>`,
    probeKeys: ['match'],
    quickIters: 20_000,
    benches: [
      // { op: 'match', selector: '#target',          ref: { by: 'id', id: 'target' }, iters: 100_000 },
      // { op: 'match', selector: '.foo',             ref: { by: 'id', id: 'target' }, iters: 100_000 },
      // { op: 'match', selector: 'div',              ref: { by: 'id', id: 'target' }, iters: 100_000 },
      // { op: 'match', selector: '[data-x]',         ref: { by: 'id', id: 'target' }, iters: 100_000 },
      // { op: 'match', selector: '[data-x="value"]', ref: { by: 'id', id: 'target' }, iters: 100_000 },
      { op: 'match', selector: '#target',          ref: { by: 'id', id: 'target' }, iters: 100_000, cold: true },
      { op: 'match', selector: '.foo',             ref: { by: 'id', id: 'target' }, iters: 100_000, cold: true },
      { op: 'match', selector: 'div',              ref: { by: 'id', id: 'target' }, iters: 100_000, cold: true },
      { op: 'match', selector: '[data-x]',         ref: { by: 'id', id: 'target' }, iters: 100_000, cold: true },
      { op: 'match', selector: '[data-x="value"]', ref: { by: 'id', id: 'target' }, iters: 100_000, cold: true },
    ],
  },

  {
    name: 'select cold slick template-standard selector corpus',
    status: 'skip',
    browsers: ['chromium'],
    markup: htmlStandard,
    markupMode: 'html-document',
    probeKeys: ['select'],
    quickIters: 2_000,
    benches: [
      // ID selectors
      { op: 'select', selector: '#title', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'h1#title', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'div.head h1#title', ref: { by: 'document' }, iters: 10_000, cold: true },

      // Class selectors
      { op: 'select', selector: 'dd.vcard > .fn', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: '.vcard .url.fn', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: '.nest.a1 .flatInNest.a6', ref: { by: 'document' }, iters: 10_000, cold: true },

      // Attribute selectors
      { op: 'select', selector: 'a.url.fn[lang="tr"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'a[href^="http://www.w3.org/TR/"][href*="selectors"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'a[href$=".html"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 10_000, cold: true },

      // Table / structural selectors
      { op: 'select', selector: 'table.selectorsReview tr > td.pattern', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'li.tocline2 > a[href^="#"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'li.tocline3 > ul.toc a[href="#universal-selector"]', ref: { by: 'document' }, iters: 10_000, cold: true },

      // :has()
      { op: 'select', selector: 'tr:has(> td.pattern)', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'div.example:has(> pre)', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'dd.vcard:has(a.url.fn[href^="mailto:"])', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'h4:has(a[name="attribute-substrings"]) + p + dl dt code', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'div:has(> b.flatOut.a1) > i.flatOut.a2 + b.flatOut.a3', ref: { by: 'document' }, iters: 10_000, cold: true },

      // :is()
      { op: 'select', selector: ':is(h1, h2, h3)', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'div:is(.head, .subtoc, .example)', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'li:is(.tocline2, .tocline3) > a[href^="#"]', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'a:is(.url.fn, [href^="mailto:"], [href$="css3-selectors"])', ref: { by: 'document' }, iters: 10_000, cold: true },

      // Grouped selector lists / multiple arms
      { op: 'select', selector: 'h1#title, div.subtoc > h2, p.copyright', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'td.pattern, td.meaning, td.origin', ref: { by: 'document' }, iters: 10_000, cold: true },
      { op: 'select', selector: 'div > b.flatOut.a1, div > i.flatOut.a2, div > b.flatOut.a3', ref: { by: 'document' }, iters: 10_000, cold: true },
    ],
  },

  {
    name: 'select hot slick template-standard selector corpus',
    status: 'skip',
    browsers: ['chromium'],
    markup: htmlStandard,
    markupMode: 'html-document',
    probeKeys: ['select'],
    quickIters: 5_000,
    benches: [
      // ID selectors
      { op: 'select', selector: '#title', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'h1#title', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'div.head h1#title', ref: { by: 'document' }, iters: 50_000 },

      // Class selectors
      { op: 'select', selector: 'dd.vcard > .fn', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: '.vcard .url.fn', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: '.nest.a1 .flatInNest.a6', ref: { by: 'document' }, iters: 50_000 },

      // Attribute selectors
      { op: 'select', selector: 'a.url.fn[lang="tr"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'a[href^="http://www.w3.org/TR/"][href*="selectors"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'a[href$=".html"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'a[name="attribute-substrings"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'a[href*="Consortium/Legal"]', ref: { by: 'document' }, iters: 50_000 },

      // Table / structural selectors
      { op: 'select', selector: 'table.selectorsReview tr > td.pattern', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'li.tocline2 > a[href^="#"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'li.tocline3 > ul.toc a[href="#universal-selector"]', ref: { by: 'document' }, iters: 50_000 },

      // :has()
      { op: 'select', selector: 'tr:has(> td.pattern)', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'div.example:has(> pre)', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'dd.vcard:has(a.url.fn[href^="mailto:"])', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'h4:has(a[name="attribute-substrings"]) + p + dl dt code', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'div:has(> b.flatOut.a1) > i.flatOut.a2 + b.flatOut.a3', ref: { by: 'document' }, iters: 50_000 },

      // :is()
      { op: 'select', selector: ':is(h1, h2, h3)', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'div:is(.head, .subtoc, .example)', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'li:is(.tocline2, .tocline3) > a[href^="#"]', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'a:is(.url.fn, [href^="mailto:"], [href$="css3-selectors"])', ref: { by: 'document' }, iters: 50_000 },

      // Grouped selector lists / multiple arms
      { op: 'select', selector: 'h1#title, div.subtoc > h2, p.copyright', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'td.pattern, td.meaning, td.origin', ref: { by: 'document' }, iters: 50_000 },
      { op: 'select', selector: 'div > b.flatOut.a1, div > i.flatOut.a2, div > b.flatOut.a3', ref: { by: 'document' }, iters: 50_000 },
    ],
  },

]);
