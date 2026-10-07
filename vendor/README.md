# Vendored dependencies

`vendor-lock.json` records the revisions and patches prepared by the vendor command.
The generated checkouts and package archives are ignored; the source revision and patches are not.
The preparation command resets only the selected vendor checkout to that revision.

## Undici

The [Fetch implementation](../src/fetch/README.md) uses Undici's dispatcher for
HTTP transport. Undici is pinned to `328ab8435079ca6edc1236a29e45a46915456502` (8.11.2).
The [patch](_patches/undici.patch) preserves Node's original HTTP/2 response, interim,
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

### Prepare and test

```sh
npm run install:vendor -- undici
npm install
node --test vendor/undici/test/http2-raw-headers.js
```

The vendor command prepares the checkout and packs its runtime files as
`vendor/undici-8.11.2.tgz` for npm to install. The test command exercises the raw-header
regression; Browlet's [transport regressions](../src/fetch/README.md#tests) cover
the consuming Fetch behavior.

Both workspace manifests depend on the archive. Browlet bundles Undici and its
license when packed. The build copies it from the workspace installation into
the package's own `node_modules`, since npm's workspace packing omits hoisted bundles.

When a published Undici release includes these fixes, run Browlet's HTTP/1.1 and
HTTP/2 regressions against it, change both manifests back to that release, update
the npm lock, and remove the vendor entry, patch, and bundled-dependency setting.
Retain Browlet's protocol tests. This patch does not fix Undici's public Fetch
duplicate-Location handling; Browlet owns that algorithm itself.

## jsdom

`npm run install:vendor -- jsdom` prepares the existing Selectlet integration,
including its build and jsdom dependencies. It requires the workspace's npm
dependencies to be installed first. Omitting a name prepares all active entries.

## Node.js / V8

[node-v8.patch](_patches/node-v8.patch) contains the V8 extensions and regression
tests for custom Node builds. Its header records the upstream base revision and
the source commit. See [Node compatibility](../node-compat/README.md) for the
capabilities, addon tests, and build instructions.
