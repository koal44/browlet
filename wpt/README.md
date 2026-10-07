# Web Platform Tests

[suites/](suites/) contains one JSON file per suite, selecting upstream tests and
recording reviewed exceptions. [suite.schema.json](suite.schema.json) provides
editor validation and is checked by the installer and runner using Ajv.
[wpt-lock.json](wpt-lock.json) pins the upstream revision. The ignored `tests/`
directory is a sparse Git checkout; upstream assertions remain unchanged.

## Install and run

```sh
npm run install:wpt
npm run test:browlet:wpt
# Run one configured suite:
npm run test:browlet:wpt -- -t 'fetch:'
# Test the selection and expectation machinery:
node scripts/with-node.mjs vitest run --project=unit test/wpt
```

The [installer](scripts/install.ts) caches the pinned manifest under `.cache/`
and reuses downloaded Git objects. Rerun it after changing suites or the lock;
an expanded selection may require additional downloads. Dirty upstream checkouts
are rejected, and the runner checks that HEAD matches the lock.

## Suite configuration

The filename supplies the suite name: `suites/fetch.json` defines `fetch`.
Each suite has a directory prefix. All patterns below it are relative to that
directory. This example illustrates the shape, not current classifications:

```json
{
  "$schema": "../suite.schema.json",
  "directory": "/fetch/api/",
  "include": ["headers/**", "response/**"],
  "skip": [
    { "test": "**/*.any.worker.html", "reason": "harness-limitation" }
  ],
  "failing": [
    {
      "test": "response/example.any.html",
      "subtests": ["One unfinished case"],
      "reason": "not-implemented"
    }
  ]
}
```

- Omit `include` to select every testharness URL beneath `directory`. An empty
  list selects none. Other manifest test types remain outside this runner.
- Patterns use Node's POSIX glob syntax, including `*`, `**`, and brace groups.
  A `?` starts a literal query suffix, not a single-character wildcard. Match
  runnable URLs such as `example.any.html`, not source files such as `example.any.js`.
- `skip` prevents execution and retains a printable reason. It applies to entire
  test URLs; `subtests` on a skip rule is rejected. Tests outside `include` are
  unselected, not configured skips.
- `failing` allows assertion failures. With `subtests`, only those exact names
  may fail, and each must fail. Omit it for a coarse whole-test expectation:
  at least one subtest must fail; other subtests may pass. Prefer named subtests
  when practical because whole-test rules can conceal additional assertion bugs.
- Reasons are `not-implemented`, `implementation-bug`, `harness-limitation`, or
  `contested`. All reasons allow an optional `note`.
- Repeated entries for one URL may describe disjoint subtests. Conflicting rules,
  unused patterns, missing subtest names, and unexpected passes fail validation.
  Different suites must select disjoint URLs; overlapping includes within a suite
  are deduplicated.
- `support` optionally lists extra fixture paths or globs under the same directory.
  Harness scripts and direct `META: script` dependencies are installed automatically.

Timeouts, not-run results, failed preconditions, harness errors, and
document-loading failures remain unexpected, even with a `failing` rule.

## Results and current boundary

Vitest runs one test per selected document URL. WPT discovers subtests during
execution; failures include their original names and diagnostics. The summary
counts passing subtests, expected failures, and contested failures separately.
A green Vitest run means results match reviewed expectations, not that every
upstream assertion passed. `-t` filters documents before they execute.

The catalogue comes from WPT's manifest, preserving generated URLs and query
variants and excluding fixtures from runnable tests. The current Browlet adapter
supports HTML testharness documents and Window `.any.js` variants on one local
HTTP origin. Worker globals, HTTPS/multiple origins, dynamic server handlers,
testdriver, and other WPT test types need further runner work. Broadening a suite
does not silently skip those requirements.

Catalogue URL counts and dynamically discovered subtest counts are separate;
the summary's unselected count covers testharness URLs only.

## Progress graphic

Each run writes `test-results/wpt/progress.svg` and `test-results/wpt/results.json`,
including raw reports, reviewed expectations, diagnostics, durations, revisions,
and the selected runtime. A filtered run reports only the URLs it actually runs;
configured skips and other unrun URLs remain untested.

The denominator is **all testharness URLs in the pinned manifest**, including
globals and features the runner cannot yet exercise. Visual tests, reftests,
and other manifest types are outside this initial scope.
Each URL contributes one unit, divided among its subtests: 11 passes and two
failures contribute 11/13 passing and 2/13 failing. Reviewed contested failures
are blue; other failures stay red, including expected failures. Unrun URLs are
gray. Loading failures, harness failures, and empty reports count as one failing
unit because their full subtest population is unknown.

The [generator](progress.ts) keeps the total and legend inside the SVG.
The [WPT workflow](../.github/workflows/wpt.yml) runs the selected suites on
Windows x64 with Node 26.8.1 and the compatibility addon, retaining the graphic
and results even when tests fail. Unexpected results still fail the job.

On `main`, the workflow also publishes the generated files through GitHub Pages:
[progress.svg](https://koal44.github.io/browlet/wpt/progress.svg) and
[results.json](https://koal44.github.io/browlet/wpt/results.json). The root README
loads the published image.
Pull requests and other branches retain artifacts without replacing public results.
A completed report is published even when tests fail; canceled runs and setup
failures without a report leave the previous publication in place.

Enable this once in **Settings → Pages → Build and deployment → Source → GitHub
Actions**. The `github-pages` environment must allow deployments from `main`.
See GitHub's [custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
GitHub's image cache may lag updates; the workflow artifact contains the exact
result. Local runs do not publish.

Further work: [roadmap](ROADMAP.md). Upstream references:
[custom runner guidance](https://web-platform-tests.org/running-tests/custom-runner.html),
[expectation metadata](https://web-platform-tests.org/tools/wptrunner/docs/expectation.html).
Our suite configuration is a Browlet adapter, not native wptrunner INI metadata.
