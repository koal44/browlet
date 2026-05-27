import { runScenarios } from '../../dispatch';

runScenarios('pseudo-user-action', 'normal', [
  {
    name: 'user action hover matches target ancestors',
    // status: 'only',
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <div id="inner" style="width:20px;height:20px;"></div>
      </div>`,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#inner').hover();
        },
        cases: [
          { select: '#inner:hover', expect: { ids: ['inner'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
        ],
      },
    ],
  },

  {
    name: 'user action focus active and focus-visible behavior',
    // status: 'only',
    markup: `<input id="a" autofocus><input id="b">`,
    setupPage: async (page) => {
      await page.locator('#b').focus();
    },
    cases: [
      { select: '#b:focus', expect: { ids: ['b'] } },
      { select: '#a:focus', expect: { ids: [] } },
      { select: 'input:focus', expect: { ids: ['b'] } },

      // :active is not the same as document.activeElement.
      { select: '#b:active', expect: { ids: [] } },

      // autofocus alone does not imply current focus/focus-visible.
      { select: '#a:focus-visible', expect: { ids: [] } },

      // Focused text inputs are focus-visible in the tested engines.
      { select: '#b:focus-visible', expect: { ids: ['b'] } },
    ],
  },

  {
    name: 'user action focus-within matches focused element ancestors',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html>
      <body id="body">
        <div id="outer">
          <input id="inner">
        </div>
        <div id="other"></div>
      </body>
      </html>`,
    setupPage: async (page) => {
      await page.locator('#inner').focus();
    },
    cases: [
      { select: '#inner:focus-within', expect: { ids: ['inner'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#body:focus-within', expect: { ids: ['body'] } },
      { select: '#other:focus-within', expect: { ids: [] } },

      // :focus-visible is not ancestor-propagating.
      { select: '#outer:focus-visible', expect: { ids: [] } },
      { select: '#inner:focus-visible', expect: { ids: ['inner'] } },
    ],
  },

  {
    name: 'user action focus matches programmatic tabindex focus',
    // status: 'only',
    markup: `<div id="x" tabindex="-1"></div><input id="y">`,
    setupPage: async (page) => {
      await page.locator('#x').evaluate((el) => (el as HTMLElement).focus());
    },
    cases: [
      { select: '#x:focus', expect: { ids: ['x'] } },
      { select: '#y:focus', expect: { ids: [] } },
    ],
  },

  {
    name: 'user action active matches pressed element ancestors',
    // status: 'only',
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <button id="inner" style="display:block;width:20px;height:20px;padding:0;"></button>
      </div>
      <div id="other" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#inner').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active follows pointer down state',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:40px;height:40px;">
        <div id="inner" style="width:20px;height:20px;"></div>
      </div>
      <div id="other" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#inner').hover();
        },
        cases: [
          { select: '#inner:hover', expect: { ids: ['inner'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
          { select: '#inner:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active matches pressed ordinary div',
    // status: 'only',
    markup: `<div id="x" style="width:20px;height:20px;"></div>`,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#x:hover', expect: { ids: [] } },
          { select: '#x:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#x').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#x:hover', expect: { ids: ['x'] } },
          { select: '#x:active', expect: { ids: ['x'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.up();
        },
        cases: [
          { select: '#x:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active keyboard activation state',
    // status: 'only',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer">
        <button id="inner">x</button>
      </div>
      <button id="other">y</button>`,
    steps: [
      {
        setupPage: async (page) => {
          await page.locator('#inner').focus();
        },
        cases: [
          { select: '#inner:focus', expect: { ids: ['inner'] } },
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.keyboard.down('Space');
        },
        cases: [
          { select: '#inner:active', expect: { ids: ['inner'] }, browsers: ['chromium', 'webkit'] },
          { select: '#inner:active', expect: { ids: [] }, browsers: ['firefox'] },
          { select: '#outer:active', expect: { ids: [] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.keyboard.up('Space');
        },
        cases: [
          { select: '#inner:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action focus pseudos distinguish focus visible and within',
    // status: 'only',
    markupMode: 'html-document',
    markup: `
      <!doctype html>
      <html id="html">
      <body id="body">
        <section id="outer">
          <div id="middle">
            <input id="inner">
          </div>
        </section>
        <input id="other">
      </body>
      </html>`,
    setupPage: async (page) => {
      await page.locator('#inner').focus();
    },
    cases: [
      // :focus matches the focused element itself only.
      { select: '#inner:focus', expect: { ids: ['inner'] } },
      { select: '#middle:focus', expect: { ids: [] } },
      { select: '#outer:focus', expect: { ids: [] } },
      { select: '#other:focus', expect: { ids: [] } },

      // For focused text inputs, native engines expose :focus-visible.
      // Unlike :focus-within, it does not propagate to ancestors.
      { select: '#inner:focus-visible', expect: { ids: ['inner'] } },
      { select: '#middle:focus-visible', expect: { ids: [] } },
      { select: '#outer:focus-visible', expect: { ids: [] } },

      // :focus-within matches the focused element and its ancestors.
      { select: '#inner:focus-within', expect: { ids: ['inner'] } },
      { select: '#middle:focus-within', expect: { ids: ['middle'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#body:focus-within', expect: { ids: ['body'] } },
      { select: '#other:focus-within', expect: { ids: [] } },

      // Useful aggregate comparisons.
      { select: ':focus', expect: { ids: ['inner'] } },
      { select: ':focus-visible', expect: { ids: ['inner'] } },
      { select: ':focus-within', expect: { ids: ['html', 'body', 'outer', 'middle', 'inner'] } },
    ],
  },

  {
    name: 'user action focus-visible differs from focus for pointer-focused button',
    status: 'fixme',
    // engines: ['native'],
    // browsers: ['webkit'],
    markup: `
      <button id="button" style="display:block;width:40px;height:30px;">x</button>
      <input id="input" style="display:block;width:80px;height:30px;">`,
    steps: [
      {
        setupPage: async (page) => {
          await page.locator('#button').click();
        },
        cases: [
          { select: '#button:focus', expect: { ids: ['button'] }, browsers: ['chromium', 'firefox'] },
          { select: '#button:focus', expect: { ids: [] }, browsers: ['webkit'] },

          // Mouse-focused buttons generally do not get focus-visible.
          { select: '#button:focus-visible', expect: { ids: [] } },

          { select: '#input:focus', expect: { ids: [] } },
          { select: '#input:focus-visible', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#input').click();
        },
        cases: [
          { select: '#input:focus', expect: { ids: ['input'] } },

          // Text inputs support keyboard input, so browsers normally expose
          // focus-visible even when focus came from a pointer click.
          { select: '#input:focus-visible', expect: { ids: ['input'] } },

          { select: '#button:focus', expect: { ids: [] } },
          { select: '#button:focus-visible', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action focus-within crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer">
        <div id="host">
          <template shadowrootmode="open">
            <section id="shadowOuter">
              <input id="inner">
            </section>
          </template>
        </div>
        <div id="other"></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.locator('#host').evaluate((host) => {
        const input = (host as HTMLElement).shadowRoot!.getElementById('inner') as HTMLInputElement;
        input.focus();
      });
    },
    cases: [
      { select: '#inner:focus', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
      { select: '#shadowOuter:focus-within', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

      // These are the cross-boundary cases parentElement walking will miss.
      { select: '#host:focus-within', expect: { ids: ['host'] } },
      { select: '#outer:focus-within', expect: { ids: ['outer'] } },
      { select: '#other:focus-within', expect: { ids: [] } },
    ],
  },

  {
    name: 'user action hover crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:80px;height:80px;">
        <div id="host" style="display:block;width:60px;height:60px;">
          <template shadowrootmode="open">
            <section id="shadowOuter" style="display:block;width:40px;height:40px;">
              <div id="inner" style="width:20px;height:20px;"></div>
            </section>
          </template>
        </div>
        <div id="other" style="width:20px;height:20px;"></div>
      </div>
    `,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#shadowOuter:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:hover', expect: { ids: [] } },
          { select: '#outer:hover', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#host').evaluate((host) => {
            const inner = (host as HTMLElement).shadowRoot!.getElementById('inner') as HTMLElement;
            inner.scrollIntoView();
          });
          const box = await page.locator('#host').boundingBox();
          if (!box) throw new Error('missing host box');
          await page.mouse.move(box.x + 10, box.y + 10);
        },
        cases: [
          { select: '#inner:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
          { select: '#shadowOuter:hover', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

          // Cross-boundary propagation.
          { select: '#host:hover', expect: { ids: ['host'] } },
          { select: '#outer:hover', expect: { ids: ['outer'] } },
          { select: '#other:hover', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active crosses shadow boundary',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <div id="outer" style="width:80px;height:80px;">
        <div id="host" style="display:block;width:60px;height:60px;">
          <template shadowrootmode="open">
            <section id="shadowOuter" style="display:block;width:40px;height:40px;">
              <button id="inner" style="display:block;width:20px;height:20px;padding:0;"></button>
            </section>
          </template>
        </div>
        <div id="other" style="width:20px;height:20px;"></div>
      </div>
    `,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#shadowOuter:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          const box = await page.locator('#host').boundingBox();
          if (!box) throw new Error('missing host box');
          await page.mouse.move(box.x + 10, box.y + 10);
          await page.mouse.down();
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inner'] } },
          { select: '#shadowOuter:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['shadowOuter'] } },

          // Cross-boundary propagation.
          { select: '#host:active', expect: { ids: ['host'] } },
          { select: '#outer:active', expect: { ids: ['outer'] } },
          { select: '#other:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.up();
        },
        cases: [
          { select: '#inner:active', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
          { select: '#host:active', expect: { ids: [] } },
          { select: '#outer:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'user action active propagates from label to labeled control',
    status: 'fixme',
    // engines: ['native'],
    markup: `
      <label id="label" for="control" style="display:block;width:80px;height:30px;">label</label>
      <input id="control" style="display:block;width:80px;height:30px;">
    `,
    steps: [
      {
        setupPage: async (page) => {
          await page.mouse.move(200, 200);
        },
        cases: [
          { select: '#label:active', expect: { ids: [] } },
          { select: '#control:active', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.locator('#label').hover();
          await page.mouse.down();
        },
        cases: [
          { select: '#label:active', expect: { ids: ['label'] } },
          { select: '#control:active', expect: { ids: ['control'] } },
        ],
      },
      {
        setupPage: async (page) => {
          await page.mouse.up();
        },
        cases: [
          { select: '#label:active', expect: { ids: [] } },
          { select: '#control:active', expect: { ids: [] } },
        ],
      },
    ],
  },

  {
    name: 'focus tracks body html and input explicitly',
    // status: 'only',
    markupMode: 'html-document',
    markup: `<!doctype html><html id=html tabindex="-1"><body id=body tabindex="-1"><input id=input1></body></html>`,
    steps: [
      {
        cases: [
          { select: ':focus', expect: { ids: [] } },
        ],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.body.focus(); }); },
        cases: [
          { select: ':focus', expect: { ids: ['body'] } },
        ],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.documentElement.focus(); }); },
        cases: [
          { select: ':focus', expect: { ids: ['html'] }, browsers: ['chromium', 'webkit'] },
          { select: ':focus', expect: { ids: [] }, browsers: ['firefox'] },
        ],
      },
      {
        setupPage: async (page) => { await page.evaluate(() => { document.getElementById('input1')!.focus(); }); },
        cases: [
          { select: ':focus', expect: { ids: ['input1'] } },
        ],
      },
    ],
  },

]);
