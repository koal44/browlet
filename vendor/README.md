# Vendored dependencies

`vendor-lock.json` records each upstream revision and its tracked patch.
The generated checkouts and package archives are ignored; the source revision and patches are not.
The preparation command resets only the selected vendor checkout to that revision.

## Undici

```sh
node scripts/vendor.ts undici
npm install
```

This command runs before dependencies are installed, using Node's built-in
TypeScript support. It prepares the checkout and packs its runtime files as
`vendor/undici-8.11.2.tgz`, without running Undici's package scripts. It does not
require tsx or run an installation hook.

Undici is pinned to `328ab8435079ca6edc1236a29e45a46915456502` (8.11.2).
`_patches/undici.patch` preserves Node's original HTTP/2 response, interim,
trailer, and CONNECT fields through Undici's raw-header APIs. Parsed-header
consumers keep their existing representation. The patch also carries its
upstream-style regression tests. See [Undici #5898](https://github.com/nodejs/undici/issues/5898).

It also corrects `DispatchOptions.body` to accept the iterables already supported
by both protocol implementations. Browlet passes its upload iterator directly;
Undici's HTTP/2 Node-stream path observes response data for upload progress.
The iterator path reports the actual upload chunks and avoids an extra stream.

The HTTP/1.1 patch removes the special rejection of unsolicited `100 Continue`
responses. They pass through the existing informational-response path while the
client awaits the final response. Regression tests cover repeated 100 responses
through Fetch and response ordering for pipelined requests on one connection.

The HTTP/1.1 patch also accepts a 304's representation Content-Length without
expecting response body bytes. Its regression preserves the header, completes
the empty response, and reuses the connection for the next request. Ordinary
body-length validation remains in place.

Development history is kept on `codex/http2-raw-headers-experiment` in the regular
Undici reference checkout. The raw-header fix, iterable-body typing correction,
unsolicited-100 repair (`41496d5d`), and 304 repair (`10e3655e`) are separate
commits. Keep further fixes separate there before updating the tracked vendor
patch; the generated checkout is disposable.

Both workspace manifests install the archive through ordinary `undici` imports.
Browlet bundles this dependency when packed so its artifact does not depend on a
consumer having our vendor directory. The build copies bundled dependencies from
the workspace installation into the package's own `node_modules`, since npm's
workspace packing otherwise omits hoisted bundles. Undici's license is included.

The focused dependency regression is:

```sh
node --test vendor/undici/test/http2-raw-headers.js
```

When a published Undici release includes these fixes, run Browlet's HTTP/1.1 and
HTTP/2 regressions against it, change both manifests back to that release, update
the npm lock, and remove the vendor entry, patch, and bundled-dependency setting.
Retain Browlet's protocol tests. This patch does not fix Undici's public Fetch
duplicate-Location handling; Browlet owns that algorithm itself.

## jsdom

`npm run install:vendor -- jsdom` prepares the existing Selectlet integration,
including its build and jsdom dependencies. It requires the workspace's npm
dependencies to be installed first. Omitting a name prepares all active entries.
