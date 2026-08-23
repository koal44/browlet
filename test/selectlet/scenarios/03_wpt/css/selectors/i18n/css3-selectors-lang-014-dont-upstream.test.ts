import { runScenarios } from '../../../../../../scenario/dispatch';

runScenarios('lang pseudo', 'normal', [
  {
    name: 'selectors 4 lang region matches language script region',
    // status: 'only',
    markup: `
      <div class="test">
        <div id="box" lang="cs-Latn-CZ">&nbsp;</div>
      </div>

      <p id="colonlangcontroltest" lang="xx">
        This test failed because it relies on :lang for results.
      </p>
    `,
    cases: [
      { match: '#box:lang(cs-CZ)', ref: { by: 'id', id: 'box' }, expect: { ids: [] }, browsers: ['chromium'], engines: ['native'] },
      { match: '#box:lang(cs-CZ)', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { match: ':lang(cs-CZ)', ref: { by: 'id', id: 'box' }, expect: { ids: [] }, browsers: ['chromium'], engines: ['native'] },
      { match: ':lang(cs-CZ)', ref: { by: 'id', id: 'box' }, expect: { ids: ['box'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      // Control: ordinary exact language match still works.
      { match: '#colonlangcontroltest:lang(xx)', ref: { by: 'id', id: 'colonlangcontroltest' }, expect: { ids: ['colonlangcontroltest'] } },
      { match: ':lang(xx)', ref: { by: 'id', id: 'colonlangcontroltest' }, expect: { ids: ['colonlangcontroltest'] } },

      // Negative controls.
      { match: '#box:lang(cs-SK)', ref: { by: 'id', id: 'box' }, expect: { ids: [] } },
      { match: '#box:lang(en)', ref: { by: 'id', id: 'box' }, expect: { ids: [] } },

      // Selection path too, since the original WPT uses matches(), but jsdom
      // failures can surface through both APIs.
      { select: '#box:lang(cs-CZ)', expect: { ids: [] }, browsers: ['chromium'], engines: ['native'] },
      { select: '#box:lang(cs-CZ)', expect: { ids: ['box'] }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { select: '#colonlangcontroltest:lang(xx)', expect: { ids: ['colonlangcontroltest'] } },
    ],
  },
]);
