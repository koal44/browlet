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

The repository can run its root and composite package scripts under either
stock Node or a local Browlet-compatible Node build without duplicating those
scripts. Copy `.env.example` to `.env`, set the compatible executable's
absolute path, and select the usual default runtime there. A command-line
`--runtime` selection overrides the shell environment, which overrides `.env`;
the default is stock Node. The local `.env` and compiled Node binary are
intentionally not committed.

```powershell
npm.cmd run with-node -- test:quick
npm.cmd run with-node -- --runtime stock test:quick
```

Compatible mode verifies the explicit VM queue, opaque context handle, stable
global-proxy detach/reattach, and immutable-prototype operations before running
the requested script. It does not treat Node's shared VM principal as browser
origin policy. Root composite scripts remain on the selected executable because
orchestration uses `node --run`. The vendor setup script remains a
package-manager boundary and may invoke npm's stock Node.

## License

MIT. Each distributable package includes its own license file.
