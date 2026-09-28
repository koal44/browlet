# WPT roadmap

The [README](README.md) owns installation, suite configuration, and result
interpretation. Selection, reviewed exceptions, the pinned manifest, and the
local Window adapter are established. Keep the current selection while resolving
its failures; broader coverage should accompany implementation milestones in
[project priority](../src/PRIORITY.md).

## A. Investigate the selected tests

The FileReader/event-loop repair and typed native Promise views clear the selected
WPT failures without changing expectations. All 82 selected documents now pass.

The borrowed-stream regressions, including the recovered release, termination,
and piping cases, are fixed. Browser disagreements remain recorded in
[Streams](../src/streams/README.md#specification-correspondence).
Distinguish implementation defects from runner limitations and disputed tests.
Keep focused regressions for fixes; changing an expectation requires review.
The empty multipart FormData result is already recorded as contested in the
[Fetch suite](suites/fetch.json).

Completion: every selected unexpected result has a fix or a reviewed disposition,
with harness errors and unhandled rejections still visible.

## B. Reports and CI at the presentation checkpoint

This work can precede full HTML loading. Coordinate it with the GitHub/package
presentation pass, after A:

- Save WPT-compatible machine-readable results with original URL/subtest names
  and statuses. Retain Browlet/WPT revisions, runtime/backend, selected suites,
  durations, and reviewed expectations/reasons alongside the report.
- Choose a reproducible Node/addon configuration using the existing
  [runtime guidance](../node-compat/README.md#runtime-test-matrix). Keep results
  from different configurations distinguishable.
- Gate changes on a bounded selection, unexpected failures, unexpected passes,
  and harness errors. Add broader scheduled coverage as capabilities arrive;
  coverage reporting must distinguish raw passes from expected failures.
- Cache the pinned checkout/manifest, retain failure artifacts, and report
  selected, skipped, and unselected test URLs separately from executed subtests.
  Do not present a selected-suite percentage as overall WPT conformance.
- Review upstream revision updates as changes to tests and expectations together.
  Show added/removed URLs and changed results before accepting new expectations.

## C. Use WPT's servers with Document loading

Start this alongside the first Fetch-backed Document and external classic-script
slice in priority stage 5. The [loader](../src/browlet/loader/ROADMAP.md),
[parser](../src/browlet/html/parser/ROADMAP.md), and
[scripting](../src/browlet/scripting/ROADMAP.md) owners supply those capabilities.
`document.write()` gates tests using dynamic markup; it is not a prerequisite
for every WPT test or for starting server integration.

1. Install the pinned WPT server tooling, its Python dependencies, and the support
   directories required by selected tests. The current direct-script fixture
   selection is insufficient for dynamic handlers and their imports.
2. Start WPT's servers once per run, with their hostname/port configuration and
   trusted test certificates. Load pages and scripts through Browlet's Fetch,
   preserving response status, headers, bytes, redirects, and policy inputs.
3. Use WPT's generated `.any.html`/`.window.html` resources, metadata, query
   variants, substitutions, and handlers. Retire the handwritten Window-page
   generator and file substitution when this path works.
4. Prove a generated Window test, an external classic script, an HTTPS test,
   and a cross-origin Fetch test with a dynamic response. Verify timeout and
   teardown behavior before adding parallel execution.

Use [WPT's server facilities](https://web-platform-tests.org/writing-tests/server-features.html)
directly. Vitest can continue orchestrating Browlet while the server owns test
resources; fetching source strings with Node's global fetch would bypass the
browser loading behavior these tests need to exercise.

## D. Grow with the browser

Add directory-sized selections when their prerequisites land, including broader
DOM/HTML tests during stages 2-5, child-context tests with stage 7, and worker
variants with stage 9. Layout/reftests require stage 6's rendering and capture;
testdriver requires the corresponding automation capabilities. Unsupported test
types remain separately inventoried rather than appearing as passing coverage.

Revisit a [wptrunner integration](https://web-platform-tests.org/tools/wptrunner/docs/design.html)
when process isolation, crash recovery, parallelism, and automation justify it.
That requires a Browlet browser/executor adapter and an explicit mapping from
our suite expectations to upstream metadata. It is not required to use wptserve.

## Browser precedents worth retaining

- [Firefox](https://firefox-source-docs.mozilla.org/web-platform/index.html)
  separates upstream tests from per-test/subtest metadata and saves `wptreport`
  artifacts. Adopt reports first; add configuration-specific expectations only
  when measured differences require them.
- [Chromium](https://chromium.googlesource.com/chromium/src/+/main/docs/testing/web_platform_tests.md)
  separates regression checking from coverage collection and reviews imported
  failures. Keep those purposes distinct as our CI grows.
- [WebKit](https://docs.webkit.org/Infrastructure/WPTTests.html) imports selected
  directories and reviews their expectations. Expand Browlet's suites in
  similarly bounded groups rather than enabling an entire unsupported tree.
