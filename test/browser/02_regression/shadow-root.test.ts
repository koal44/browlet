import { runScenarios } from '../../dispatch';

runScenarios('shadow-root', 'normal', [
  {
    name: 'shadow-root/declarative-slot',
    // status: 'only',
    markup: `
      <div id="host">
        <span id="light" slot="x"></span>
        <template shadowrootmode="open">
          <slot name="x"></slot>
        </template>
      </div>
    `,
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/basic-query-context',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML =
          `<section><p id="inside" class="x"></p></section>`;
      });
    },
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
      { select: 'section .x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

  {
    name: 'shadow-root/closest-stays-inside-shadow-tree',
    // status: 'only',
    markup: `<div id="host"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML =
          `<section id="section"><p id="inside"></p></section>`;
      });
    },
    cases: [
      { closest: 'section', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { ids: ['section'] } },
      { closest: '#host', ref: { by: 'id', id: 'inside', within: { by: 'shadowRoot', id: 'host' } }, expect: { count: 0 } },
    ],
  },

  {
    name: 'shadow-root/slotted-light-dom-is-not-shadow-descendant',
    // status: 'only',
    markup: `<div id="host"><span id="light" slot="x"></span></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot name="x"></slot>`;
      });
    },
    cases: [
      { select: '#light', ref: { by: 'id', id: 'host' }, expect: { ids: ['light'] } },
      { select: '#light', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 0 } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { count: 1 } },
    ],
  },

  {
    name: 'shadow-root/nested-shadow-context',
    // status: 'only',
    markup: `<div id="outer"></div>`,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const outer = document.getElementById('outer')!;
        const outerRoot = outer.attachShadow({ mode: 'open' });
        outerRoot.innerHTML = `<div id="inner-host"></div>`;
        outerRoot.getElementById('inner-host')!.attachShadow({ mode: 'open' }).innerHTML =
          `<p id="deep" class="x"></p>`;
      });
    },
    cases: [
      { select: '#deep', expect: { count: 0 } },
      { select: '#deep', ref: { by: 'shadowRoot', id: 'outer' }, expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'inner-host', within: { by: 'shadowRoot', id: 'outer' } }, expect: { ids: ['deep'] } },
    ],
  },

  {
    name: 'shadow-root/declarative-basic',
    // status: 'only',
    markup: `
      <div id="host">
        <template shadowrootmode="open">
          <p id="inside" class="x"></p>
        </template>
      </div>
    `,
    cases: [
      { select: '#inside', expect: { count: 0 } },
      { select: '.x', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['inside'] } },
    ],
  },

]);
