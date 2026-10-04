// V1 forecast agent CLI. Run from the repo root:  npx tsx agent/cli.ts <command> <job-dir> [args]
// A job dir lives OUTSIDE the repo (default ~/v1-agent-jobs/<date>-<slug>/) and holds narration.*,
// the agent's two files (transcript.fixed.json, plan.json, picks.json) and every derived artifact.
import { compose, qc, renderBg, renderGfx } from "./tools/render";
import { align, doctor, picksValidate, planValidate, transcribe } from "./tools/basic";
import { search } from "./tools/catalog";

const [cmd, dir, ...rest] = process.argv.slice(2);
const need = () => { if (!dir) { console.error(`usage: ${cmd} <job-dir>`); process.exit(2); } return dir; };

const COMMANDS: Record<string, () => Promise<void> | void> = {
  doctor: () => doctor(),
  transcribe: () => transcribe(need()),
  align: () => align(need()),
  "plan-validate": () => planValidate(need()),
  search: () => search(need(), rest[0], rest[1] ? Number(rest[1]) : 12),
  "picks-validate": () => picksValidate(need()),
  "render-bg": () => renderBg(need()),
  "render-gfx": () => renderGfx(need(), rest[0] === "--at" ? rest[1] : undefined),
  compose: () => compose(need()),
  qc: () => qc(need()),
};

if (!cmd || !COMMANDS[cmd]) {
  console.log(`commands: ${Object.keys(COMMANDS).join(", ")}\n  search <job> <scene-id> [k]   ·   render-gfx <job> [--at 1.5,9.2]`);
  process.exit(cmd ? 2 : 0);
}
await COMMANDS[cmd]();
