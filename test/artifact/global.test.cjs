const assert = require('node:assert/strict');
const fs = require("node:fs");
const path = require("node:path");
const { test } = require('node:test');
const vm = require("node:vm");

const selectletSource = fs.readFileSync(
  path.resolve(__dirname, '../../packages/selectlet/dist/selectlet.js'),
  'utf8',
);
const styleletSource = fs.readFileSync(
  path.resolve(__dirname, '../../packages/stylelet/dist/stylelet.js'),
  'utf8',
);

const document = {
  nodeType: 9,
  baseURI: "about:blank",
  documentElement: {
    nodeType: 1,
    ownerDocument: null,
  },
  contentType: "text/html",
  compatMode: "CSS1Compat",
  addEventListener() {},
};

document.documentElement.ownerDocument = document;

const context = vm.createContext({
  document,
  URL,
  DOMException,
  setTimeout,
  clearTimeout,
});

vm.runInContext(selectletSource, context, {
  filename: 'packages/selectlet/dist/selectlet.js',
});
vm.runInContext(styleletSource, context, {
  filename: 'packages/stylelet/dist/stylelet.js',
});

if (typeof context.createSelectlet !== "function") {
  throw new Error(`Expected global createSelectlet function, got ${typeof context.createSelectlet}`);
}

if (typeof context.Stylelet !== "function") {
  throw new Error(`Expected global Stylelet class, got ${typeof context.Stylelet}`);
}

const sxlt = context.createSelectlet(document);

if (typeof sxlt.select !== "function") throw new Error("Expected sxlt.select");
if (typeof sxlt.matches !== "function") throw new Error("Expected sxlt.matches");

const stlt = new context.Stylelet(document);

if (typeof stlt.createStyleSheet !== "function") {
  throw new Error("Expected stlt.createStyleSheet");
}

const sheet = stlt.createStyleSheet({ baseURL: "https://example.test/assets/" });
if (sheet.href !== "about:blank" || sheet.interpretedStyleSheet.baseUrl.href !== "https://example.test/assets/") {
  throw new Error("Expected standalone stylesheet URL resolution through the native provider");
}

console.log("global artifact passed");

test('loads Stylelet without ambient timers and uses supplied execution', async () => {
  const timerFreeContext = vm.createContext({ document, URL, DOMException });
  vm.runInContext(styleletSource, timerFreeContext, {
    filename: 'packages/stylelet/dist/stylelet.js',
  });

  const env = stlt.context.env;
  for (const options of [{ exec: env.exec }, { env }]) {
    const styles = new timerFreeContext.Stylelet(document, options);
    assert.equal(styles.context.env.exec, env.exec);
    const sheet = styles.createStyleSheet();
    const result = await new Promise((resolve, reject) => {
      sheet.replace('main { color: red }').observe(resolve, reject);
    });
    assert.equal(result, sheet);
    assert.equal(sheet.cssRules.length, 1);
  }
});
