<p align="center">
  <img src="assets/browlet.svg" width="160" alt="Browlet owl">
</p>

# Browlet

A headless JavaScript browser, written in TypeScript and built against web standards.

The goal is a programmable browser environment for Node.js, with faithful DOM,
HTML, and CSS behavior.

## Development status

Browlet is in early development. Many of the underlying subsystems are in place;
the next focus is DOM, HTML, and document loading.

CSS and layout remain substantial work ahead. Scope beyond layout is still open.

## Web Platform Tests

<p>
  <a href="https://github.com/koal44/browlet/actions/workflows/wpt.yml">
    <img src="https://koal44.github.io/browlet/wpt/progress.svg" width="360" height="58" alt="Web Platform Tests progress">
  </a>
</p>

Fuller WPT integration depends on further document and script-loading work.

## Standalone engines

- [Selectlet](packages/selectlet) — CSS selector engine.
- [Stylelet](packages/stylelet) — CSS style engine.

[Development](DEVELOPMENT.md)
