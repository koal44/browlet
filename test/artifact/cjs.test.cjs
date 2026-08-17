const path = require("node:path");

const mod = require(path.resolve(__dirname, "../../dist/index.cjs"));

if (!mod || typeof mod !== "object") {
  throw new Error(`Expected CommonJS require(dist/index.cjs) to return module object, got ${typeof mod}`);
}

if (typeof mod.createSelectlet !== "function") {
  throw new Error(`Expected createSelectlet export to be function, got ${typeof mod.createSelectlet}`);
}

if (typeof mod.Stylelet !== "function") {
  throw new Error(`Expected Stylelet export to be class, got ${typeof mod.Stylelet}`);
}

if (!mod.DEFAULT_CONFIG || typeof mod.DEFAULT_CONFIG !== "object") {
  throw new Error(`Expected DEFAULT_CONFIG export to be object, got ${typeof mod.DEFAULT_CONFIG}`);
}

console.log("cjs artifact passed");
