import { runScenarios } from '../../../../../../../scenario/dispatch';

runScenarios('dir pseudo', 'normal', [
  {
    name: 'wpt dir on input is not altered by text children',
    // status: 'only',
    markup: `<input id="x" value="ltr" dir="auto">`,
    steps: [
      {
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { document.getElementById('x')!.textContent = 'ﷺ'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).value = 'ltr2'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { (document.getElementById('x') as HTMLInputElement).value = 'ﷺ'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.evaluate(() => { document.getElementById('x')!.textContent = 'ltr'; });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'x' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'x' }, expect: { ids: ['x'] } },
        ],
      },
    ],
  },
]);
