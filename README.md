# Browlet

Browlet is a monorepo containing three web engines developed against web specs:

- [Browlet](packages/browlet) is a browser-like engine.
- [Stylelet](packages/stylelet) is a CSS style engine.
- [Selectlet](packages/selectlet) is a CSS selector engine.

The project is tested with unit suites, Playwright comparisons, and selected WPTs.

## Development

```sh
npm install
npm run build
npm run test:unit
```

## License

MIT. Each distributable package includes its own license file.
