import { runScenarios } from '../dispatch';

runScenarios('style oracle selector prelude boundaries', 'normal', [
  {
    name: 'selectlet cssom reads a simple declaration',
    status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 3px; }
      </style>
    `,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        ref: { by: 'id', id: 'sheet' },
        expect: {
          cssom: { name: 'margin-left', value: '3px', important: false },
        },
      },
    ],
  },

]);
