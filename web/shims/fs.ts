// `node:fs` for the browser build: the memfs volume mirrored to the folder.
import { webFs } from "../runtime/vfs";

export default webFs;
export const {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  lstatSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  unlinkSync,
  rmSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  promises,
} = webFs;
