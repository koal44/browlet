import { runScenarios } from '../dispatch';

const SELECTOR = '.box:first-child ~ .box:nth-of-type(4n) + .box .block.inner > .content';

/*
DOM shape:
  #container
  ├─ #box0.box.container
  │  └─ 5 × .block.outer
  │     └─ 5 × .block.inner
  │        └─ 25 × p.content
  ├─ #box1.box.container
  │  └─ 25 × p.content
  ├─ #box2.box.container
  │  └─ 25 × p.content
  ├─ #box3.box.container
  │  └─ 25 × p.content
  └─ #box4.box.container
     └─ 5 × .block.outer
        └─ 5 × .block.inner
           └─ 25 × p.content

Selectivity:
  .box                                                  -> 5
  .box:first-child                                      -> 1  (#box0)
  .box:first-child ~ .box                               -> 4  (#box1..#box4)
  .box:first-child ~ .box:nth-of-type(4n)               -> 1  (#box3)
  .box:first-child ~ .box:nth-of-type(4n) + .box        -> 1  (#box4)
  .content                                              -> 125
  .block.inner > .content                               -> 125
  #box4 .block.inner > .content                         -> 25
  full selector                                         -> 25
*/

runScenarios('complex selector', 'normal', [
  {
    name: 'jsdom complex selector selectivity',
    status: 'only',
    markup: complexMarkup(),
    cases: [
      { select: '.box', expect: { ids: ['box0', 'box1', 'box2', 'box3', 'box4'] } },
      { select: '.box:first-child', expect: { ids: ['box0'] } },
      { select: '.box:first-child ~ .box', expect: { ids: ['box1', 'box2', 'box3', 'box4'] } },
      { select: '.box:first-child ~ .box:nth-of-type(4n)', expect: { ids: ['box3'] } },
      { select: '.box:first-child ~ .box:nth-of-type(4n) + .box', expect: { ids: ['box4'] } },
      { select: '.content', expect: { count: 125 } },
      { select: '.block.inner', expect: { count: 125 } },
      { select: '.block.inner > .content', expect: { count: 125 } },
      { select: '#box4 .block.inner > .content', expect: { count: 25 } },
      { select: SELECTOR, expect: { count: 25 } },
      { select: SELECTOR, ref: { by: 'id', id: 'container' }, expect: { count: 25 } },
      { select: '#box4 .content', expect: { ids: ['p4-0-0', 'p4-0-1', 'p4-0-2', 'p4-0-3', 'p4-0-4', 'p4-1-0', 'p4-1-1', 'p4-1-2', 'p4-1-3', 'p4-1-4', 'p4-2-0', 'p4-2-1', 'p4-2-2', 'p4-2-3', 'p4-2-4', 'p4-3-0', 'p4-3-1', 'p4-3-2', 'p4-3-3', 'p4-3-4', 'p4-4-0', 'p4-4-1', 'p4-4-2', 'p4-4-3', 'p4-4-4'] } },
      { select: SELECTOR, expect: { ids: ['p4-0-0', 'p4-0-1', 'p4-0-2', 'p4-0-3', 'p4-0-4', 'p4-1-0', 'p4-1-1', 'p4-1-2', 'p4-1-3', 'p4-1-4', 'p4-2-0', 'p4-2-1', 'p4-2-2', 'p4-2-3', 'p4-2-4', 'p4-3-0', 'p4-3-1', 'p4-3-2', 'p4-3-3', 'p4-3-4', 'p4-4-0', 'p4-4-1', 'p4-4-2', 'p4-4-3', 'p4-4-4'] } },
    ],
  },
]);

function complexMarkup(): string {
  const x = 5;
  const y = 5;
  const z = 5;
  let html = '<div id="container" class="container">';

  for (let i = 0; i < x; i++) {
    html += `<div id="box${i}" class="box container">`;

    for (let j = 0; j < y; j++) {
      html += `<div id="div${i}-${j}" class="block outer">`;

      for (let k = 0; k < z; k++) {
        html += `<div id="div${i}-${j}-${k}" class="block inner">`;
        html += `<p id="p${i}-${j}-${k}" class="content">${i}-${j}-${k}</p>`;
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  return html;
}
