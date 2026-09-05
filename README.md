# Browlet

Browlet is a monorepo containing three web engines developed against web specs:

- [Browlet](packages/browlet) is a browser-like engine.
- [Stylelet](packages/stylelet) is a CSS style engine.
- [Selectlet](packages/selectlet) is a CSS selector engine.

The project is tested with unit suites, Playwright comparisons, and selected WPTs.

Cross-subsystem design decisions are recorded in the
[subsystem composition architecture](src/subsystem-architecture.md) and the
[platform-object architecture](src/platform-object-architecture.md).

## Development

```sh
npm install
npm run build
npm run test:unit
```

### Node runtime selection

The [compatibility addon](node-compat/README.md) adds shared microtask queues
and reusable contexts to a selected Node base. Copy `.env.example` to `.env`:

- `NODE_BASE`: `custom`, `24.19.0`, or `26.8.1` (default: `24.19.0`).
- `NODE_RUNTIME`: `compat` enables the addon; `stock` runs the base alone
  (default: `compat`).
- `CUSTOM_NODE_SOURCE`: absolute path to the regular Node source checkout,
  required for the custom base.

Addon builds and all test commands use these settings. The shell environment
overrides `.env`. Each base has its own addon binary. Local settings, downloaded
dependencies and generated binaries are not committed.

```powershell
npm.cmd run test:unit
npm.cmd run test:artifact
npm.cmd run test:node-compat
npm.cmd run test:quick
```

The internal `scripts/with-node.mjs` launcher reads the selection, reports the
actual executable and addon, and forwards test arguments and exit status.
It accepts `node`, `vitest`, and `playwright`; package scripts call it directly
to avoid another shell-parsing step through a nested package-script alias.
The compat runtime checks its queues and context handles before running the
tests. Prototype immutability remains unimplemented and appears as
a failing compatibility test on the ordinary browser bootstrap path; the
separate native-global allocation prototype is covered by focused tests.

Build the custom Node engine in its regular checkout, then compile the addon
against that checkout's headers and import library. The addon workflow does
not build the Node engine. See the compatibility README for preparation and
build commands.

Neither backend treats Node's shared VM principal as browser origin policy.
Composite test commands call the same runtime-selecting test scripts. Browser
oracles use the selected Node for Playwright; the browser engines are independent.

## License

MIT. Each distributable package includes its own license file.
