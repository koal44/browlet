const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../../dist/selectlet.js"), "utf8");

const document = {
  nodeType: 9,
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
});

vm.runInContext(source, context, { filename: "dist/selectlet.js" });

if (typeof context.createSelectlet !== "function") {
  throw new Error(`Expected global createSelectlet function, got ${typeof context.createSelectlet}`);
}

const sxlt = context.createSelectlet(document);

if (typeof sxlt.select !== "function") throw new Error("Expected sxlt.select");
if (typeof sxlt.match !== "function") throw new Error("Expected sxlt.match");

console.log("global artifact passed");