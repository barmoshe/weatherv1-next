// `node:module` for the browser build. `createRequire` is only used to load
// archiver for the Premiere export route, which the browser build swaps; any
// required module is a stand-in that fails when actually called.
export function createRequire(): (id: string) => unknown {
  return (id: string) => () => {
    throw new Error(`require("${id}") is not available in the browser build`);
  };
}
export default { createRequire };
