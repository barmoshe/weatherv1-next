// `node:stream` for the browser build: readable-stream (Node's own stream
// code, packaged for browsers), plus the web-stream bridge the server code
// calls (`Readable.toWeb`), which readable-stream doesn't carry.
import * as rs from "readable-stream";

type NodeReadable = { on(ev: string, cb: (x?: unknown) => void): void };

class Readable extends rs.Readable {
  static toWeb(stream: NodeReadable): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk as Uint8Array));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });
  }
  static fromWeb(): never {
    throw new Error("Readable.fromWeb is not available in the browser build");
  }
}

export { Readable };
export const { Writable, Duplex, Transform, PassThrough, Stream, pipeline, finished } = rs;
export default { ...rs, Readable };
