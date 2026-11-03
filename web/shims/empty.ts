// Stand-in for server-only packages the browser build never calls
// (argon2: the editor login is off in the browser build).
export default {};
export const hash = async () => "";
export const verify = async () => false;
