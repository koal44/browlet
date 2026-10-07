# Selectlet scenarios

Selector scenarios from legacy suites, regressions, and WPT. By default, the
Playwright runner compares Selectlet with native DOM behavior in Chromium,
Firefox, and WebKit, then checks explicit expectations. Cases can select a single
engine. The Browlet runner checks explicit expectations for its supported subset.

## Install

Follow [Building Browlet](../../BUILDING.md), including the Node runtime and
[browser setup](../../BUILDING.md#browser-tests).

## Run

```sh
npm run build
# Compare with browsers:
npm run test:selectlet:oracle
# Run through Browlet:
npm run test:selectlet:browlet
# Review cases marked fixme:
npm run test:selectlet:oracle:fixme
# Filter by label:
npm run test:selectlet:oracle jquery
npm run test:selectlet:oracle:fixme w3c
```

`fixme` cases are open questions or known mismatches found during migration and need review.

## Tests

```ts
import { runScenarios } from '../../scenario/dispatch';

runScenarios('jquery', 'normal', [
  {
    name: 'id selectors',
    markup: `<div id="a"></div><div id="b"></div>`,
    cases: [
      { select: '#a', expect: { ids: ['a'] } },
      { select: '#b', expect: { ids: ['b'] } },
    ],
  },
]);
```

## Scenarios

Scenarios can:

- choose engines (`selectlet`, `native`) and browsers
- provide inline HTML fixtures
- use `setupPage` to run page-side JavaScript before assertions
- use steps to change page state between groups of cases
- express cases using `select`, `first`, `match`, `closest`, `byId`, `byTag`, and `byClass`
- attach expectations such as `count`, `ids`, `classes`, `throws`, and inclusion/exclusion checks
- use query source refs to query a specific node in its original document, detached, or rehomed into a `DocumentFragment`
- mark scenarios or cases as `skip`, `only`, `fail`, or `fixme`

## Notes

For simple iframes, `srcdoc` is often enough. For more control, give the scenario a `url` to ground the parent page, then navigate the frame to routed HTML on the same origin.
