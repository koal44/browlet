import { runScenarios } from '../../../../dispatch';

runScenarios('css/css-scoping/slotted-matches', 'normal', [
  {
    name: `::slotted() doesn't reveal assigned nodes through DOM selector APIs`,
    // status: 'only',
    markup: `
      <div id="host">
        <div id="slotted"></div>
      </div>
    `,
    setupPage: async (page) => {
      await page.evaluate(() => {
        const host = document.getElementById('host')!;
        host.attachShadow({ mode: 'open' }).innerHTML = `<slot id="slot"></slot>`;
      });
    },
    cases: [
      { match: '::slotted(div)', ref: { by: 'id', id: 'slotted' }, expect: { ids: [] } },
      { select: '::slotted(div)', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: '::slotted(*)', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: [] } },
      { select: 'slot', ref: { by: 'shadowRoot', id: 'host' }, expect: { ids: ['slot'] } },
    ],
  },
]);
