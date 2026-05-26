import { runScenarios } from '../harness/scenarios';

runScenarios('closest', 'normal', [
  {
    name: 'closest/scope-is-original-element',
    markup: `<div id="outer"><section id="mid"><p id="target"></p></section></div>`,
    cases: [
      { closest: ':scope', ref: { by: 'id', id: 'target' }, expect: { ids: ['target'] } },
      { closest: ':scope', ref: { by: 'id', id: 'mid' }, expect: { ids: ['mid'] } },
    ],
  },

  {
    name: 'closest/basic-inclusive-ancestor-walk',
    markup: `<div id="outer" class="x"><section id="mid"><p id="target"></p></section></div>`,
    cases: [
      { closest: '.x', ref: { by: 'id', id: 'target' }, expect: { ids: ['outer'] } },
      { closest: 'p', ref: { by: 'id', id: 'target' }, expect: { ids: ['target'] } },
      { closest: '.missing', ref: { by: 'id', id: 'target' }, expect: { count: 0 } },
    ],
  },

]);
