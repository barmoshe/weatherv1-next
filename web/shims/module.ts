// `node:module` for the browser build. `createRequire` is only used to load
// archiver for the Premiere export route; it gets the fflate-based stand-in.
import archiver from "./archiver";

const modules: Record<string, unknown> = { archiver };

export function createRequire(): (id: string) => unknown {
  return (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`require("${id}") is not available in the browser build`);
  };
}
export default { createRequire };
