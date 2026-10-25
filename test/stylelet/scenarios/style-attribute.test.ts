import { expect } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;

const fixtures = [
  {
    name: 'unmatched braces and at-rules do not discard subsequent declarations',
    markup: '<div id="target" style="color: red; } ignored: x; @media all { opacity: .9 } opacity: .7"></div>',
    expected: { opacity: '0.7', color: 'rgb(255, 0, 0)' },
  },
  ...['&', 'bad'].map((selector) => ({
    name: `attribute declarations do not admit a nested ${selector} rule`,
    markup: `<div id="target" style="opacity: .2; ${selector} { color: green } opacity: .5"></div>`,
    expected: { opacity: '0.2' },
  })),
];

runScenarios('style attribute declaration parsing', 'normal', fixtures.map(({ expected, ...scenario }) => ({
  ...scenario,
  engines: ['native'],
  setupPage: async (page) => {
    const browlet = new Browlet({ route: () => scenario.markup });
    await browlet.navigate('https://example.test/');
    const properties = Object.keys(expected);
    expect(await browlet.evaluate(readStyle, properties)).toEqual(expected);
    expect(await page.evaluate(readStyle, properties)).toEqual(expected);
  },
})));

function readStyle(properties: string[]): Record<string, string> {
  const style = getComputedStyle(document.getElementById('target')!);
  return Object.fromEntries(properties.map((name) => [name, style.getPropertyValue(name).trim()]));
}
