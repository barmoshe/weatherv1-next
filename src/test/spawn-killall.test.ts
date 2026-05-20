// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { registerProcess, killProcess, killAllProcesses } from "@/server/ffmpeg/spawn";

function fakeChild(): ChildProcessWithoutNullStreams & { kill: ReturnType<typeof vi.fn> } {
  return { kill: vi.fn() } as unknown as ChildProcessWithoutNullStreams & {
    kill: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  // Clear any registrations leaked from a prior test.
  killAllProcesses();
});

describe("killAllProcesses", () => {
  it("SIGKILLs every registered child and empties the registry", async () => {
    const a = fakeChild();
    const b = fakeChild();
    registerProcess("job-a", a);
    registerProcess("job-b", b);

    killAllProcesses();

    expect(a.kill).toHaveBeenCalledWith("SIGKILL");
    expect(b.kill).toHaveBeenCalledWith("SIGKILL");

    // Registry is empty now — killing a removed id is a no-op (no throw).
    a.kill.mockClear();
    killProcess("job-a");
    expect(a.kill).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is registered", () => {
    expect(() => killAllProcesses()).not.toThrow();
  });
});
