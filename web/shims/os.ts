// `node:os` for the browser build.
const os = {
  tmpdir: () => "/tmp",
  cpus: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, () => ({})),
  availableParallelism: () => navigator.hardwareConcurrency || 4,
  platform: () => "browser",
  homedir: () => "/home",
  EOL: "\n",
};
export default os;
export const { tmpdir, cpus, availableParallelism, platform, homedir, EOL } = os;
