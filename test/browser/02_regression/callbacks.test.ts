import { runScenarios } from '../../dispatch';

runScenarios('callbacks', 'normal', [
  {
    name: 'callback compile cache does not leak across select calls',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="d">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        // First compile/cache without callback.
        const plain = api.select('#d .x', document);

        // Then same selector with callback.
        const withCb = api.select('#d .x', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        if (plain.length !== 2) throw new Error(`plain length ${plain.length}`);
        if (withCb.length !== 1) throw new Error(`withCb length ${withCb.length}`);
        if (calls.join(',') !== 'a') throw new Error(`callback calls ${calls.join(',')}`);
      });
    },
  },

  {
    name: 'callback compile cache does not leak into later non-callback select',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="d">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        const withCb = api.select('#d .x', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        const plain = api.select('#d .x', document);

        if (withCb.length !== 1) throw new Error(`withCb length ${withCb.length}`);
        if (plain.length !== 2) throw new Error(`plain length ${plain.length}`);
        if (calls.join(',') !== 'a') throw new Error(`callback calls ${calls.join(',')}`);
      });
    },
  },

  {
    name: 'select callback order and early stop',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="root">
        <span id="a" class="x"></span>
        <span id="b" class="x"></span>
        <span id="c" class="x"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        const results = api.select('#root > .x', document, (el: Element) => {
          calls.push(el.id);
          return el.id !== 'b';
        });

        const resultIds = [...results].map((el: Element) => el.id);

        if (calls.join(',') !== 'a,b') {
          throw new Error(`Expected callback calls a,b; got ${calls.join(',')}`);
        }

        if (resultIds.join(',') !== 'a,b') {
          throw new Error(`Expected results a,b; got ${resultIds.join(',')}`);
        }
      });
    },
  },

  {
    name: 'select callback false does not cache partial results for later callbacks',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="root">
        <span id="a"></span>
        <span id="b"></span>
        <span id="c"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        const firstCalls: string[] = [];
        const first = api.select('#a, #b, #c', document, (el: Element) => {
          firstCalls.push(el.id);
          return false;
        });

        const secondCalls: string[] = [];
        const second = api.select('#a, #b, #c', document, (el: Element) => {
          secondCalls.push(el.id);
          return true;
        });

        const firstIds = [...first].map((el: Element) => el.id);
        const secondIds = [...second].map((el: Element) => el.id);

        if (firstCalls.join(',') !== 'a') {
          throw new Error(`Expected first callback calls a; got ${firstCalls.join(',')}`);
        }

        if (firstIds.join(',') !== 'a') {
          throw new Error(`Expected first results a; got ${firstIds.join(',')}`);
        }

        if (secondCalls.join(',') !== 'a,b,c') {
          throw new Error(`Expected second callback calls a,b,c; got ${secondCalls.join(',')}`);
        }

        if (secondIds.join(',') !== 'a,b,c') {
          throw new Error(`Expected second results a,b,c; got ${secondIds.join(',')}`);
        }
      });
    },
  },

  {
    name: 'select callback false stops across selector groups',
    // status: 'only',
    engines: ['selectlet'],
    markup: `
      <div id="root">
        <span id="a" class="x"></span>
        <span id="b" class="y"></span>
        <span id="c" class="z"></span>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const calls: string[] = [];
        const api = selectlet;
        if (!api) throw new Error('selectlet not found');

        const results = api.select('#a, #b, #c', document, (el: Element) => {
          calls.push(el.id);
          return false;
        });

        const resultIds = [...results].map((el: Element) => el.id);

        if (calls.join(',') !== 'a') {
          throw new Error(`Expected callback calls a; got ${calls.join(',')}`);
        }

        if (resultIds.join(',') !== 'a') {
          throw new Error(`Expected results a; got ${resultIds.join(',')}`);
        }
      });
    },
  },

]);
