import { runScenarios } from '../../dispatch';

runScenarios('registered-pseudos', 'normal', [
  {
    name: 'registered pseudo matches form controls',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="root">
        <button id="button1"></button>
        <input id="input1" />
        <textarea id="textarea1"></textarea>
        <span id="span1"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        api.registerPseudo('x-control', (e) =>
          /^(BUTTON|INPUT|SELECT|TEXTAREA)$/i.test(e.nodeName)
        );
      });
    },
    cases: [
      { select: ':x-control', expect: { ids: ['button1', 'input1', 'textarea1'] } },
      { select: '#root > :x-control', expect: { ids: ['button1', 'input1', 'textarea1'] } },
      { select: 'span:x-control', expect: { ids: [] } },
      { select: ':X-Control', expect: { ids: ['button1', 'input1', 'textarea1'] } },
    ],
  },

  {
    name: 'registered pseudo filters compound candidates',
    // status: 'only',
    engines: ['selectlet'],
    markup: `<div id="x"></div><span id="y"></span>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = selectlet;
        if (!sxlt) throw new Error('selectlet not found');

        sxlt.registerPseudo('test-ext', (e) => e.localName === 'div');
      });
    },
    cases: [
      { select: '#x:test-ext', expect: { ids: ['x'] } },
      { select: '#y:test-ext', expect: { ids: [] } },
    ],
  },

  {
    name: 'registered pseudos can emulate jquery element filters',
    // status: 'only',
    engines: ['selectlet'],
    markupMode: 'html-document',
    markup: `
      <!DOCTYPE html>
      <html id="html1">
      <head id="head1">
        <title id="title1">Test</title>
      </head>
      <body id="body1">
      <div id="root">
        <input id="checkbox1" type="checkbox">
        <input id="file1" type="file">
        <input id="image1" type="image">
        <input id="password1" type="password">
        <input id="radio1" type="radio">
        <input id="reset1" type="reset">
        <input id="submit1" type="submit">
        <input id="text1" type="text">

        <button id="button1"></button>
        <select id="select1"><option id="option1">one</option></select>
        <textarea id="textarea1"></textarea>

        <h1 id="h1"></h1>
        <h3 id="h3"></h3>
        <h6 id="h6"></h6>

        <div id="parent1"><span id="child1"></span></div>
        <div id="empty1"></div>

        <div id="visible1" style="width: 10px; height: 10px;"></div>
        <div id="hidden1" style="display: none;"></div>

        <div id="has-span"><span id="inside-span"></span></div>
        <div id="has-em"><em id="inside-em"></em></div>
        <div id="has-none"></div>
      </div>
      </body>
      </html>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = selectlet;
        if (!sxlt) throw new Error('selectlet not found');

        const isHtmlElement = (e: Element): e is HTMLElement => e.namespaceURI === 'http://www.w3.org/1999/xhtml';
        const localNameIs = (name: string) => (e: Element) => isHtmlElement(e) && e.localName === name;
        const isInput = (e: Element): e is HTMLInputElement => isHtmlElement(e) && e.localName === 'input';
        const inputTypeIs = (type: string) => (e: Element) => isInput(e) && e.type.toLowerCase() === type;

        sxlt.registerPseudo('checkbox', inputTypeIs('checkbox'));
        sxlt.registerPseudo('file', inputTypeIs('file'));
        sxlt.registerPseudo('image', inputTypeIs('image'));
        sxlt.registerPseudo('password', inputTypeIs('password'));
        sxlt.registerPseudo('radio', inputTypeIs('radio'));
        sxlt.registerPseudo('reset', inputTypeIs('reset'));
        sxlt.registerPseudo('submit', inputTypeIs('submit'));
        sxlt.registerPseudo('text', inputTypeIs('text'));
        sxlt.registerPseudo('button', localNameIs('button'));
        sxlt.registerPseudo('input', (e) => /^(button|input|select|textarea)$/.test(e.localName));
        sxlt.registerPseudo('header', (e) => /^h[1-6]$/.test(e.localName));
        sxlt.registerPseudo('parent', (e) => e.firstChild !== null);
        sxlt.registerPseudo('hidden', (e) => isHtmlElement(e) && getComputedStyle(e).display === 'none');
        sxlt.registerPseudo('visible', (e) => isHtmlElement(e) && getComputedStyle(e).display !== 'none');
      });
    },
    cases: [
      { select: ':checkbox', expect: { ids: ['checkbox1'] } },
      { select: ':file', expect: { ids: ['file1'] } },
      { select: ':image', expect: { ids: ['image1'] } },
      { select: ':password', expect: { ids: ['password1'] } },
      { select: ':radio', expect: { ids: ['radio1'] } },
      { select: ':reset', expect: { ids: ['reset1'] } },
      { select: ':submit', expect: { ids: ['submit1'] } },
      { select: ':text', expect: { ids: ['text1'] } },

      { select: ':button', expect: { ids: ['button1'] } },
      {
        select: ':input', expect: {
          ids: [
            'checkbox1', 'file1', 'image1', 'password1', 'radio1', 'reset1', 'submit1', 'text1',
            'button1', 'select1', 'textarea1',
          ],
        },
      },
      { first: ':input', expect: { ids: ['checkbox1'] } },

      { select: ':header', expect: { ids: ['h1', 'h3', 'h6'] } },
      { select: 'h3:header', expect: { ids: ['h3'] } },

      { select: ':parent', expect: { includesIds: ['root', 'select1', 'parent1', 'has-span', 'has-em'] } },
      { select: '#empty1:parent', expect: { ids: [] } },
      { match: ':parent', ref: { by: 'id', id: 'parent1' }, expect: { ids: ['parent1'] } },
      { match: ':parent', ref: { by: 'id', id: 'empty1' }, expect: { count: 0 } },

      { select: ':hidden', expect: { ids: ['head1', 'title1', 'hidden1'] } },
      {
        select: ':visible', expect: {
          ids: [
            'html1', 'body1', 'root', 'checkbox1', 'file1', 'image1', 'password1', 'radio1', 'reset1', 'submit1',
            'text1', 'button1', 'select1', 'option1', 'textarea1', 'h1', 'h3', 'h6', 'parent1', 'child1', 'empty1',
            'visible1', 'has-span', 'inside-span', 'has-em', 'inside-em', 'has-none',
          ],
        },
      },
    ],
  },

  {
    name: 'registered pseudos emulate jquery positional filters',
    status: 'fixme',
    engines: ['selectlet'],
    markup: `
      <div id="root">
        <span id="s0" class="item"></span>
        <span id="s1" class="item"></span>
        <span id="s2" class="item"></span>
        <span id="s3" class="item"></span>
        <span id="s4" class="item"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const sxlt = selectlet;
        if (!sxlt) throw new Error('selectlet not found');

        // TODO: These require candidate-order / iteration-state support, not just (e) => boolean.
        // :first, :last, :eq(n), :lt(n), :gt(n), :even, :odd, :nth(n)
      });
    },
    cases: [
      { select: '.item:first', expect: { ids: ['s0'] } },
      { select: '.item:last', expect: { ids: ['s4'] } },
      { select: '.item:eq(2)', expect: { ids: ['s2'] } },
      { select: '.item:lt(2)', expect: { ids: ['s0', 's1'] } },
      { select: '.item:gt(2)', expect: { ids: ['s3', 's4'] } },
      { select: '.item:even', expect: { ids: ['s0', 's2', 's4'] } },
      { select: '.item:odd', expect: { ids: ['s1', 's3'] } },
    ],
  },

]);
