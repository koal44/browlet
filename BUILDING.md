# Building Browlet

Browlet runs on stock Node.js. An optional compatibility addon exposes additional
native capabilities. Custom Node builds with our V8 patches extend these further.

## Build from source

```sh
git clone https://github.com/koal44/browlet.git
cd browlet

npm run install:vendor -- undici
npm ci
npm run build
```

The vendor step prepares the [patched Undici dependency](vendor/README.md).

`npm run build` builds Browlet, Selectlet, and Stylelet. To build only the
standalone engines, use `npm run build -- selectlet stylelet`.

## Stock Node.js

Copy [.env.example](.env.example) to `.env` and select the test runtime:

```ini
NODE_BASE=26.8.1
NODE_RUNTIME=stock
```

```sh
npm run install:node
npm run test:unit
```

The installer downloads the selected Node version into `node-compat/.cache`
on Windows and Linux x64.
Node 24.19.0 is also supported; set `NODE_BASE=24.19.0` to select it.

The unit suite uses Node's ordinary heap limit. Vitest 5 fixes the
[mock registry retention](https://github.com/vitest-dev/vitest/pull/11092)
that kept discarded Window realms alive in reused workers; increasing
the heap ceiling is unnecessary. The launcher preserves caller-supplied
`NODE_OPTIONS` unchanged.

Unit runs use up to four workers, bounded by available CPU parallelism. The
realm-heavy files and subprocess fixtures otherwise compete for enough CPU and
memory to cause intermittent timeouts. Use `--maxWorkers` for deliberate local
comparisons; the ordinary test timeouts remain unchanged.

Declaration generation and test fixtures load TypeScript through `test/support/typescript.cjs`.
It keeps TSX's transform cache under `node-compat/.cache/tsx-unit`, avoiding a
linear lookup through the shared temporary cache from other projects/worktrees.
`requireTypeScript()` uses a stable, scoped namespace so unchanged source reuses
its cached transform across runs without taking over Playwright's loader. TSX's
default scoped require uses a timestamp namespace and misses those cache entries.
Source changes still invalidate transforms; evaluated modules remain local to
their process. The normal temp environment is restored before loaded code runs.

Dedicated TypeScript subprocess fixtures retain their ordinary CommonJS preload,
`test/support/register-typescript.cjs`, which delegates to the shared setup.
Disposable worker-isolate fixtures set `TSX_DISABLE_CACHE=1` first: their deliberate
termination can interrupt TSX's background cache writes and delay process exit
on Windows. Production worker startup loads the package bundle, without TSX.
`TSX_DISABLE_CACHE` also remains available for cache-free comparisons; no Node
compile cache is enabled here.

## Browser tests

The Selectlet and Stylelet browser suites use Playwright's Chromium, Firefox, and
WebKit engines. After selecting and installing a Node runtime:

```sh
npm run install:browsers
npm run test:selectlet:oracle
npm run test:stylelet:oracle
```

On Linux, use `npm run install:browsers -- --with-deps` to also install the required
system libraries.

## Node.js with the compatibility addon

**Why?** The HTML standard requires behavior that stock Node.js cannot fully
provide. Some limitations are in Node's APIs; others are in its V8 engine.
The addon and V8 patches let us implement and test these capabilities to help
motivate upstream improvements in Node.js and V8.

The addon supports Windows and Linux x64 and can be built against official or
custom Node. Follow the [addon setup](node-compat/README.md#build-and-run) and set
`NODE_RUNTIME=compat` in Browlet's `.env`.

## V8 patches

To use the [V8 patches](vendor/_patches/node-v8.patch), start with a separate Node.js
source checkout and follow Node's build prerequisites for
[Windows](https://github.com/nodejs/node/blob/6f41e415639b5ec3dd816e44945cc73b4d7651e3/BUILDING.md#windows-prerequisites) or
[Linux](https://github.com/nodejs/node/blob/6f41e415639b5ec3dd816e44945cc73b4d7651e3/BUILDING.md#unix-prerequisites).
From that checkout, apply the patch using the path to your Browlet checkout:

```sh
git switch --detach 6f41e415639b5ec3dd816e44945cc73b4d7651e3
git apply "/path/to/browlet/vendor/_patches/node-v8.patch"
```

This single patch contains the complete `v8-patches` branch, including Node's
forwarding exports and V8 facilities not yet consumed by Browlet. No second patch
is needed for dynamic imports. It also includes Node's context exception reporter;
official Node builds use the [documented compatibility fallback](node-compat/README.md#native-cleanup-error-reporting).
The addon detects the forwarding export in the
selected headers; builds without it retain classic/static module execution but
reject dynamic-import callback options.

The patch also backports the production change from
[V8 commit 1cdea338](https://github.com/v8/v8/commit/1cdea338fd59d4700b1b311feb76e6a57c679844).
Module evaluation clears its consumed exception before rejecting its completion
Promise, so a native call from a Promise hook does not report the module failure
again. The included Node regression,
`test/parallel/test-vm-module-promise-hook-native-call.js`, checks rejection
identity, absence of duplicate reports, and separate reporting of genuine hook
failures using public Node APIs. This is an engine fix; rebuilding only the addon
does not apply it.

Build on Windows:

```powershell
.\vcbuild.bat release x64
```

Or on Linux:

```sh
./configure
make -j4
```

Then select the custom build in Browlet's `.env`:

```ini
NODE_BASE=custom
NODE_RUNTIME=compat
CUSTOM_NODE_SOURCE=/path/to/node
```

Back in the Browlet checkout, build the addon against it and run the tests:

```sh
npm run build:node-compat
npm run test:unit
```
