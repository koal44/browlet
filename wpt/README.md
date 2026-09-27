# Web Platform Tests

[suites/](suites/) contains one JSON file per suite, selecting upstream tests and
recording reviewed exceptions. [suite.schema.json](suite.schema.json) provides
editor validation and is checked by the installer and runner using Ajv.
[wpt-lock.json](wpt-lock.json) pins the upstream revision. The ignored `tests/`
directory is a sparse Git checkout; upstream assertions remain unchanged.

## Install and run

```powershell
npm.cmd run install:wpt
npm.cmd run test:browlet:wpt
# Run one configured suite:
npm.cmd run test:browlet:wpt -- -t 'fetch:'
# Test the selection and expectation machinery:
node scripts/with-node.mjs vitest run --project=unit test/wpt
```

The [installer](scripts/install.ts) caches the official manifest under `.cache/`,
checking its revision against the lock. It reuses Git objects already downloaded
and fetches a commit only when missing. Changing the selection can still require
additional blobs.
Rerun installation after changing suites or the lock. Dirty upstream checkouts
are rejected, and the runner checks that checkout HEAD matches the lock.

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
document-loading failures remain unexpected. They are not excused by ordinary
failure rules. Further outcome expectations require an explicit review and
extension of the configuration.

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

The [roadmap](ROADMAP.md) orders failure investigation, CI/reporting, and server
integration against the HTML loading prerequisites.

Upstream references: [custom runner guidance](https://web-platform-tests.org/running-tests/custom-runner.html),
[expectation metadata](https://web-platform-tests.org/tools/wptrunner/docs/expectation.html).
Our suite configuration is a Browlet adapter, not native wptrunner INI metadata.
