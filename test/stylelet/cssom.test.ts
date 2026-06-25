import { runScenarios } from '../dispatch';

runScenarios('style CSSOM declaration rules', 'normal', [
  {
    name: 'simple declaration is exposed',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style id="sheet">
        .foo { margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' }, ref: { by: 'id', id: 'sheet' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'valid declaration survives malformed declaration',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { color red; margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'last normal duplicate declaration wins',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: 2px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '2px', important: false } },
      },
    ],
  },

  {
    name: 'important declaration beats later normal duplicate',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { margin-left: 1px !important; margin-left: 2px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '1px', important: true } },
      },
    ],
  },

  {
    name: 'semicolon inside custom property string does not split declaration',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { --family: "x;y"; margin-left: 3px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: '--family' },
        expect: { cssom: { name: '--family', value: '"x;y"', important: false } },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  // {
  //   name: 'semicolon inside string does not split declaration',
  //   status: 'fixme',
  //   engines: ['native', 'selectlet'],
  //   markup: `
  //     <style>
  //       .foo { font-family: "x;y"; margin-left: 3px; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'font-family' },
  //       expect: { cssom: { name: 'font-family', value: '"x;y"', important: false } },
  //     },
  //     {
  //       cssom: { kind: 'declaration', name: 'margin-left' },
  //       expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
  //     },
  //   ],
  // },

  {
    name: 'invalid selector list rule is dropped before following rule',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo, { margin-left: 3px; }
        .bar { margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
    ],
  },

  {
    name: 'invalid selector list rule is omitted',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo, { margin-left: 3px; }
        .bar { margin-left: 4px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', rule: 0, name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '4px', important: false } },
      },
      {
        cssom: { kind: 'rule', rule: 1 },
        expect: { throws: true },
      },
    ],
  },

  {
    name: 'later important duplicate beats earlier normal declaration',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: 2px !important; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '2px', important: true } },
      },
    ],
  },

  {
    name: 'invalid later duplicate does not erase earlier declaration',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { margin-left: 1px; margin-left: ; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '1px', important: false } },
      },
    ],
  },

  {
    name: 'property names are ASCII case-insensitive',
    // status: 'only',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { MARGIN-LEFT: 3px; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: '3px', important: false } },
      },
    ],
  },

  {
    name: 'auto and percentage margin declarations are exposed',
    engines: ['native', 'selectlet'],
    markup: `
      <style>
        .foo { margin-left: auto; margin-right: 10%; }
      </style>`,
    cases: [
      {
        cssom: { kind: 'declaration', name: 'margin-left' },
        expect: { cssom: { name: 'margin-left', value: 'auto', important: false } },
      },
      {
        cssom: { kind: 'declaration', name: 'margin-right' },
        expect: { cssom: { name: 'margin-right', value: '10%', important: false } },
      },
    ],
  },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "slide"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed 2',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name custom ident and string declarations are exposed 3',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name accepts css-wide keyword as whole value',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: initial; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'initial', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects css-wide keyword inside comma list',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: initial, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects css-wide keyword after comma',
  //   status: 'only',
  //   // engines: ['native', 'selectlet'],
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: slide, initial; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name distinguishes local none keyword from quoted keyframes name',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "none"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: '"none"', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name allows bare none inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, none, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, none, slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted none inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "none", slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, "none", slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name rejects bare css-wide keyword inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in; animation-name: initial, slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted css-wide keyword as keyframes name',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "initial"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: '"initial"', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name preserves quoted css-wide keyword inside comma list',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: fade-in, "initial", slide; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'fade-in, "initial", slide', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name quoted ordinary string canonicalizes to identifier',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide with space"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\ with\\ space', important: false } },
  //     },
  //   ],
  // },

  // {
  //   name: 'animation-name quoted string with comma canonicalizes to escaped identifier',
  //   status: 'only',
  //   engines: ['native'],
  //   markup: `
  //     <style>
  //       .foo { animation-name: "slide,comma"; }
  //     </style>`,
  //   cases: [
  //     {
  //       cssom: { kind: 'declaration', name: 'animation-name' },
  //       expect: { cssom: { name: 'animation-name', value: 'slide\\,comma', important: false } },
  //     },
  //   ],
  // },

]);
