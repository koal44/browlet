import { runScenarios } from '../../../../../dispatch';
import type { ContextRef } from '../../../../harness/scenarios';

const box: ContextRef = { by: 'id', id: 'box' };

runScenarios('prefixed internal pseudos parsing', 'normal', [
  {
    name: 'various prefixed pseudo-classes are not web exposed',
    // status: 'only',
    // engines: ['native'],
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: ':-internal-animating-full-screen-transition', ref: box, expect: { throws: true } },
      { match: ':-internal-fullscreen-document', ref: box, expect: { throws: true } },
      { match: ':-internal-html-document', ref: box, expect: { throws: true } },
      { match: ':-internal-media-document', ref: box, expect: { throws: true } },
      { match: ':-khtml-drag', ref: box, expect: { throws: true } },
      { match: ':-webkit-animating-full-screen-transition', ref: box, expect: { throws: true } },

      { match: ':-webkit-full-page-media', ref: box, expect: { throws: false }, browsers: ['chromium'], engines: ['native'] },
      { match: ':-webkit-full-page-media', ref: box, expect: { throws: true }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },

      { match: ':-webkit-full-screen-ancestor', ref: box, expect: { throws: false }, browsers: ['chromium'], engines: ['native'] },
      { match: ':-webkit-full-screen-ancestor', ref: box, expect: { throws: true }, browsers: ['firefox', 'webkit'], engines: ['native', 'selectlet'] },
      { match: ':-webkit-full-screen-controls-hidden', ref: box, expect: { throws: true } },
      { match: ':-webkit-full-screen-document', ref: box, expect: { throws: true } },
    ],
  },
  {
    name: 'various prefixed pseudo-elements are not web exposed',
    // status: 'only',
    markup: `
      <div id="box"></div>
    `,
    cases: [
      { match: '::-apple-attachment-controls-container', ref: box, expect: { throws: true } },
      { match: '::-internal-loading-auto-fill-button', ref: box, expect: { throws: true } },
    ],
  },
]);
