// Type declarations for the build-time-generated auth-passwords.generated.ts.
// The .ts file is gitignored and emitted by scripts/emit-auth-hashes.cjs
// during `npm run build`. These declarations let `tsc --noEmit` succeed
// in a fresh checkout before the prebuild step has run.
export declare const EDITOR_HASH: string;
export declare const ADMIN_HASH: string;
export declare const R2_APP_USERNAME: string;
