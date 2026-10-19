import { runScenarios } from '../../scenario/dispatch';

runScenarios('style attribute declaration parsing', 'normal', [
  {
    name: 'unmatched braces and at-rules do not discard subsequent declarations',
    engines: ['native', 'selectlet'],
    markup: '<div id="target" style="color: red; } ignored: x; @media all { opacity: .9 } opacity: .7"></div>',
    cases: [
      { computedStyle: 'opacity', ref: { by: 'id', id: 'target' }, expect: { value: '0.7' } },
      { computedStyle: 'color', ref: { by: 'id', id: 'target' }, expect: { value: 'rgb(255, 0, 0)' } },
    ],
  },
  ...['&', 'bad'].map((selector) => ({
    name: `attribute declarations do not admit a nested ${selector} rule`,
    markup: `<div id="target" style="opacity: .2; ${selector} { color: green } opacity: .5"></div>`,
    cases: [
      { computedStyle: 'opacity', ref: { by: 'id' as const, id: 'target' }, expect: { value: '0.2' } },
    ],
  })),
]);
