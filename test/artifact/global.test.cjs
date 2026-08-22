const fs = require("node:fs");
const path = require("node:path");
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

console.log("global artifact passed");
