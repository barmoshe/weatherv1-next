// `node:fs/promises` for the browser build.
import { webFs } from "../runtime/vfs";

const p = webFs.promises;
export default p;
export const { readFile, writeFile, mkdir, mkdtemp, rename, rm, unlink, stat, readdir, copyFile, appendFile } = p;
