import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.resolve(__dirname, "../../dist/index.mjs")));

if (typeof mod.createSelectlet !== "function") {
  throw new Error(`Expected createSelectlet export to be function, got ${typeof mod.createSelectlet}`);
}

if (!mod.DEFAULT_CONFIG || typeof mod.DEFAULT_CONFIG !== "object") {
  throw new Error(`Expected DEFAULT_CONFIG export to be object, got ${typeof mod.DEFAULT_CONFIG}`);
}

console.log("esm artifact passed");