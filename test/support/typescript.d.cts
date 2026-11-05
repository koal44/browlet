/** Load TypeScript in the shared support loader's scoped module graph. */
export function requireTypeScript(id: string, fromFile: string | URL): unknown;
/** Install the ordinary CommonJS TypeScript hook and return its unregister function. */
export function registerTypeScript(): () => void;
