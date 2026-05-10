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
    branches: [
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
    branches: [
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
    probeKeys: ['match'],
    branches: [
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
    probeKeys: ['match'],
    branches: [
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
    probeKeys: ['match'],
    branches: [
      { label: 'match tag div hit',     op: 'match', selector: 'div',      context: 'div',      iters: 5_000_000 },
      { label: 'match tag div miss',    op: 'match', selector: 'div',      context: 'button',   iters: 5_000_000 },
      { label: 'match tag button hit',  op: 'match', selector: 'button',   context: 'button',   iters: 5_000_000 },
      { label: 'match tag textarea hit',op: 'match', selector: 'textarea', context: 'textarea', iters: 5_000_000 },
    ],
  },
]);
