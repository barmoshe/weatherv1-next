// `node:util` for the browser build.
export function promisify<T extends (...args: never[]) => unknown>(fn: T) {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) =>
      (fn as unknown as (...a: unknown[]) => void)(...args, (err: unknown, value: unknown) =>
        err ? reject(err) : resolve(value),
      ),
    );
}
export default { promisify };
