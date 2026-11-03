// `proper-lockfile` for the browser build: one tab, one process, no lock needed.
const release = async () => undefined;
export const lock = async () => release;
export const lockSync = () => () => undefined;
export const unlock = async () => undefined;
export const unlockSync = () => undefined;
export const check = async () => false;
export const checkSync = () => false;
export default { lock, lockSync, unlock, unlockSync, check, checkSync };
