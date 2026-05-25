const path = require("node:path");

const Factory = require(path.resolve(__dirname, "../../dist/selectlet.js"));

if (typeof Factory !== "function") {
  throw new Error(`Expected CommonJS require(dist/selectlet.js) to return factory function, got ${typeof Factory}`);
}

console.log("cjs artifact passed");
