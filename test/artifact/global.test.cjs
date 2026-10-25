const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const selectletSource = fs.readFileSync(
  path.resolve(__dirname, '../../packages/selectlet/dist/selectlet.js'),
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

if (typeof context.createSelectlet !== "function") {
  throw new Error(`Expected global createSelectlet function, got ${typeof context.createSelectlet}`);
}

const sxlt = context.createSelectlet(document);

if (typeof sxlt.select !== "function") throw new Error("Expected sxlt.select");
if (typeof sxlt.matches !== "function") throw new Error("Expected sxlt.matches");

console.log("global artifact passed");
