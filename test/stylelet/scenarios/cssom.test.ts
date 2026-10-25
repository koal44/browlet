import { expect } from '@playwright/test';
import { require as tsRequire } from 'tsx/cjs/api';

import type * as BrowletModule from '../../../src/browlet/browlet';
import { runScenarios } from '../../scenario/dispatch';
import type { CssomCase } from '../../scenario/harness';
import { installBrowserHelpers } from '../../scenario/playwright/page';

const { Browlet } = tsRequire('../../../src/browlet/browlet.ts', __filename) as typeof BrowletModule;

const scenarios: { name: string; markup: string; cases: CssomCase[]; }[] = [
  {
    name: 'simple declaration is exposed',
    // status: 'only',
    markup: `
      <style id="sheet">
        .foo { margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' }, ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'valid declaration survives malformed declaration',
    // status: 'only',
    markup: `
      <style>
        .foo { color red; margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'discarded nested rules do not separate declarations',
    // SPEC_CLASH(css-invalid-rule-declaration-runs): Browser behavior was chosen.
    // https://github.com/w3c/csswg-drafts/issues/11271
    markup: `
      <style>
        .invalid { margin-left: 1px; & + {} margin-left: 2px; }
        .unknown { margin-left: 3px; @unknown; margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '2px', important: false } },
      },
      {
        cssom: { target: 'style.property', rule: 1, name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
    ],
  },

  {
    name: 'last normal duplicate declaration wins',
    // status: 'only',
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: 2px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '2px', important: false } },
      },
    ],
  },

  {
    name: 'important declaration beats later normal duplicate',
    // status: 'only',
    markup: `
      <style>
        .foo { margin-left: 1px !important; margin-left: 2px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '1px', important: true } },
      },
    ],
  },

  {
    name: 'semicolon inside custom property string does not split declaration',
    markup: `
      <style>
        .foo { --family: "x;y"; margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: '--family' },
        expect: { cssom: { name: '--family', value: '"x;y"', important: false } },
      },
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  // {
  //   name: 'semicolon inside string does not split declaration',
  //   status: 'fixme',
  //   engines: ['native', 'selectlet'],
  //   markup: `
  //     <style>
  //       .foo { font-family: "x;y"; margin-left: 3px; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'font-family' },
  //       expect: { cssom: { name: 'font-family', value: '"x;y"', important: false } },
  //     },
  //     {
  //       cssom: { read: 'style.property', name: 'margin-left' },
  //       expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
  //     },
  //   ],
  // },

  {
    name: 'invalid selector list rule is dropped before following rule',
    // status: 'only',
    markup: `
      <style>
        .foo, { margin-left: 3px; }
        .bar { margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
    ],
  },

  {
    name: 'invalid selector list rule is omitted',
    // status: 'only',
    markup: `
      <style>
        .foo, { margin-left: 3px; }
        .bar { margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', rule: 0, name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
      {
        cssom: { target: 'sheet.cssRules.item', rule: 1 },
        expect: { cssom: null },
      },
    ],
  },

  {
    name: 'later important duplicate beats earlier normal declaration',
    // status: 'only',
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: 2px !important; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '2px', important: true } },
      },
    ],
  },

  {
    name: 'invalid later duplicate does not erase earlier declaration',
    // status: 'only',
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: ; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '1px', important: false } },
      },
    ],
  },

  {
    name: 'property names are ASCII case-insensitive',
    // status: 'only',
    markup: `
      <style>
        .foo { MARGIN-LEFT: 3px; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'auto and percentage margin declarations are exposed',
    markup: `
      <style>
        .foo { margin-left: auto; margin-right: 10%; }
      </style>`,
    cases: [
      {
        cssom: { target: 'style.property', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: 'auto', important: false } },
      },
      {
        cssom: { target: 'style.property', name: 'margin-right' },
        expect: { cssom: { name: 'margin-right', value: '10%', important: false } },
      },
    ],
  },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "slide"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed 2',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed 3',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name accepts css-wide keyword as whole value',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: initial; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'initial', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects css-wide keyword inside comma list',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: initial, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects css-wide keyword after comma',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: slide, initial; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name distinguishes local none keyword from quoted keyframes name',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "none"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: '"none"', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name allows bare none inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, none, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, none, slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted none inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "none", slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, "none", slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects bare css-wide keyword inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: initial, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted css-wide keyword as keyframes name',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "initial"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: '"initial"', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted css-wide keyword inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "initial", slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, "initial", slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name quoted ordinary string canonicalizes to identifier',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name quoted string with comma canonicalizes to escaped identifier',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide,comma"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { read: 'style.property', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\,comma', important: false } },
  //     },
  //   ],
  // },

];

runScenarios('style CSSOM declaration rules', 'normal', scenarios.map(({ cases, ...scenario }) => ({
  ...scenario,
  engines: ['native'],
  setupPage: async (page) => {
    const browlet = new Browlet({ route: () => scenario.markup });
    await browlet.navigate('https://example.test/');
    // The same CSSOM inspection runs against the projected objects in both hosts.
    await browlet.evaluate(installBrowserHelpers);
    for (const c of cases) {
      const result = await browlet.evaluate(readCssom, c);
      if (c.expect!.cssom === null) expect(result).toBeNull();
      else expect(result).toMatchObject(c.expect!.cssom!);
      expect(await page.evaluate(readCssom, c)).toEqual(result);
    }
  },
})));

function readCssom(c: CssomCase) {
  const helpers = window.__pwHelpers;
  return helpers.readCssom(c.cssom, helpers.resolveQuerySource(document, c.ref));
}
