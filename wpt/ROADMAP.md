# WPT roadmap

The [README](README.md) owns installation, suite configuration, and result
interpretation. Selection, reviewed exceptions, the pinned manifest, and the
local Window adapter are established, and the selected unexpected failures are
resolved. Broader coverage should accompany implementation milestones in
[project priority](../src/PRIORITY.md).

## A. Investigate the selected tests

The FileReader/event-loop repair and typed native Promise views clear the selected
WPT failures without changing expectations. All 82 selected documents now match
their reviewed expectations.

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

The runner saves raw results and a fractional progress SVG, retained by the
WPT workflow and published from `main` through GitHub Pages for the README.
The [first hosted run](https://github.com/koal44/browlet/actions/runs/37537559787)
verified installation, tests, and publication together. CI uses a fixed Node/addon
configuration and fails on unexpected results and harness errors.

Remaining work, independent of full HTML loading:

- Save WPT-compatible machine-readable results with original URL/subtest names
  and statuses. Carry the existing revision, runtime, suite, duration, and reviewed
  expectation metadata into that report.
- Cache the pinned checkout and manifest between CI runs.
- Add broader scheduled coverage as capabilities arrive. Keep runtime
  configurations distinguishable and raw passes separate from expected failures.
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
