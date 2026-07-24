import { runPerfScenarios } from './harness/perf-scenario';

const SELECTOR = '.box:first-child ~ .box:nth-of-type(4n) + .box .block.inner > .content';

/*
Selector:
  .box:first-child ~ .box:nth-of-type(4n) + .box .block.inner > .content

Tree:
  body
  └─ #container.container
     ├─ #box0.box.container
     │  ├─ .block.outer × 5
     │  │  └─ .block.inner × 5
     │  │     └─ p.content × 25
     │  ├─ total .content under #box0: 25
     │
     ├─ #box1.box.container
     │  └─ .content × 25
     │
     ├─ #box2.box.container
     │  └─ .content × 25
     │
     ├─ #box3.box.container
     │  └─ .content × 25
     │
     └─ #box4.box.container
        ├─ .block.outer × 5
        │  └─ .block.inner × 5
        │     └─ p.content × 25
*/

runPerfScenarios('perf', [
  {
    name: 'complex selector jsdom shape',
    status: 'only',
    browsers: ['chromium'],
    markup: complexMarkup(),
    probeKeys: ['select', 'selBuild', 'match', 'matBuild'],
    benches: [
      { label: 'complex select', op: 'select', selector: SELECTOR, iters: 200 },
      { label: 'complex first', op: 'first', selector: SELECTOR, iters: 500 },

      { label: 'complex match deep target', op: 'match', selector: SELECTOR, ref: { by: 'id', id: 'p4-4-4' }, iters: 2000 },
      { label: 'complex closest deep target', op: 'closest', selector: SELECTOR, ref: { by: 'id', id: 'p4-4-4' }, iters: 2000 },

      { label: 'seed select .content', op: 'select', selector: '.content', iters: 500 },
      { label: 'seed first .content', op: 'first', selector: '.content', iters: 1000 },
      { label: 'subtree select #box4 .content', op: 'select', selector: '#box4 .content', iters: 500 },
      { label: 'subtree first #box4 .content', op: 'first', selector: '#box4 .content', iters: 1000 },

      { label: 'direct box4 content select', op: 'select', selector: '#box4 .block.inner > .content', iters: 500 },
      { label: 'direct box4 content first', op: 'first', selector: '#box4 .block.inner > .content', iters: 1000 },
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
