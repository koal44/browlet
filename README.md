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

Use plain stock Node or build the [compatibility addon](node-compat/README.md)
to add shared microtask queues and reusable contexts to stock Node. Copy
`.env.example` to `.env` and select `stock` or `addon` as the default runtime.
A command-line
`--runtime` selection overrides the shell environment, which overrides `.env`;
the default is stock Node. Local runtime paths and generated binaries are
not committed.

```powershell
npm.cmd run with-node -- test:quick
npm.cmd run with-node -- --runtime stock test:quick
npm.cmd run with-node -- --runtime addon test:unit
```

The addon profile checks its queues and context handles before running the
requested script. Prototype immutability remains unimplemented and appears as
a failing compatibility test.

The older `compat` mode is retained for a separately built source-patched Node.
It requires `BROWLET_COMPAT_NODE` to name that executable and checks all three
capabilities, including immutable prototypes. No source-patched executable is
supplied or rebuilt by the addon workflow.

Neither backend treats Node's shared VM principal as browser origin policy.
Root composite scripts remain on the selected executable because
orchestration uses `node --run`. The vendor setup script remains a
package-manager boundary and may invoke npm's stock Node.

## License

MIT. Each distributable package includes its own license file.
