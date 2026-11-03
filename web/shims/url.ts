// `node:url` for the browser build: the WHATWG URL plus the two helpers
// xmlbuilder2's URL parser calls (ASCII-only domains are all we ever see).
export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;
export const domainToASCII = (domain: string) => new globalThis.URL(`http://${domain}`).hostname;
export const domainToUnicode = (domain: string) => domain;
export const fileURLToPath = (u: string | URL) => decodeURIComponent(new globalThis.URL(String(u)).pathname);
export const pathToFileURL = (p: string) => new globalThis.URL(`file://${encodeURI(p)}`);
export default { URL, URLSearchParams, domainToASCII, domainToUnicode, fileURLToPath, pathToFileURL };
