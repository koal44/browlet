import { runScenarios } from '../../../../dispatch';

runScenarios('dir pseudo', 'normal', [
  {
    name: 'wpt dir auto dynamic directionality',
    // status: 'only',
    markup: `
      <style>
        #div4_1 {
          direction: rtl;
        }
      </style>

      <div id="testDivs">
        <div id="div1" dir="auto">
          <div id="div1_1">a</div>
        </div>

        <div id="div2" dir="auto">
          <div id="div2_1">ת</div>
        </div>

        <div id="div3" dir="auto">
          <div id="div3_1" dir="rtl">ת</div>
          <div id="div3_2">a</div>
        </div>

        <div id="div4" dir="auto">
          <div id="div4_1">
            <div id="div4_1_1">a</div>
          </div>
        </div>
      </div>
    `,
    steps: [
      {
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1' }, expect: { ids: ['div1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: ['div1_1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div2' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div2' }, expect: { ids: ['div2'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div2_1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div2_1' }, expect: { ids: ['div2_1'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div3' }, expect: { ids: ['div3'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div3' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div3_1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div3_1' }, expect: { ids: ['div3_1'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div3_2' }, expect: { ids: ['div3_2'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div3_2' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4' }, expect: { ids: ['div4'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4_1' }, expect: { ids: ['div4_1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4_1' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4_1_1' }, expect: { ids: ['div4_1_1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4_1_1' }, expect: { ids: [] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            document.getElementById('div1_1')!.textContent = 'ת';
            void (document.getElementById('div1_1'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1' }, expect: { ids: ['div1'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: ['div1_1'] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            (document.getElementById('div1_1'))!.dir = 'ltr';
            void (document.getElementById('div1_1'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1' }, expect: { ids: ['div1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: ['div1_1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: [] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            document.getElementById('div1_1')!.textContent = 'a';
            void (document.getElementById('div1_1'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1' }, expect: { ids: ['div1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1' }, expect: { ids: [] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: ['div1_1'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div1_1' }, expect: { ids: [] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            document.getElementById('div2_1')!.remove();
            void (document.getElementById('div2'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div2' }, expect: { ids: ['div2'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div2' }, expect: { ids: [] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            (document.getElementById('div3_1'))!.dir = '';
            void (document.getElementById('div3_1'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div3' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div3' }, expect: { ids: ['div3'] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            document.getElementById('div3')!.appendChild(document.getElementById('div3_1')!);
            void (document.getElementById('div3'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div3' }, expect: { ids: ['div3'] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div3' }, expect: { ids: [] } },
        ],
      },

      {
        setupPage: async (page) => {
          await page.evaluate(() => {
            document.getElementById('div4_1_1')!.textContent = 'ת';
            void (document.getElementById('div4_1_1'))!.offsetTop;
          });
        },
        cases: [
          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4' }, expect: { ids: ['div4'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4_1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4_1' }, expect: { ids: ['div4_1'] } },

          { match: ':dir(ltr)', ref: { by: 'id', id: 'div4_1_1' }, expect: { ids: [] } },
          { match: ':dir(rtl)', ref: { by: 'id', id: 'div4_1_1' }, expect: { ids: ['div4_1_1'] } },
        ],
      },
    ],
  },
]);
