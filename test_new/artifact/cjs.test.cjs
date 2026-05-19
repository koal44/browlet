const path = require("node:path");

const Factory = require(path.resolve(__dirname, "../../dist/nwsapi.js"));

if (typeof Factory !== "function") {
  throw new Error(`Expected CommonJS require(dist/nwsapi.js) to return factory function, got ${typeof Factory}`);
}

console.log("cjs artifact smoke passed");
