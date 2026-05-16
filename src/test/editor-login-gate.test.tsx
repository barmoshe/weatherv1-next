import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorLoginGate } from "@/client/components/auth/EditorLoginGate";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockProbe(ok: boolean) {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async () => new Response(JSON.stringify({ ok }), { status: 200 }),
  );
}

function mockLogin(response: { success: boolean; token?: string; error?: string }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async () => new Response(JSON.stringify(response), { status: 200 }),
  );
}

describe("EditorLoginGate", () => {
  it("renders children when /api/auth/me reports ok=true", async () => {
    mockProbe(true);
    render(
      <EditorLoginGate>
        <div>studio-marker</div>
      </EditorLoginGate>,
    );
    await waitFor(() => {
      expect(screen.getByText("studio-marker")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the login card when /api/auth/me reports ok=false", async () => {
    mockProbe(false);
    render(
      <EditorLoginGate>
        <div>studio-marker</div>
      </EditorLoginGate>,
    );
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.queryByText("studio-marker")).toBeNull();
  });

  it("reveals children after a successful login", async () => {
    mockProbe(false);
    mockLogin({ success: true, token: "a".repeat(64) });
    render(
      <EditorLoginGate>
        <div>studio-marker</div>
      </EditorLoginGate>,
    );
    const passwordInput = await screen.findByLabelText("סיסמה");
    fireEvent.change(passwordInput, { target: { value: "any-pw" } });
    const submit = screen.getByRole("button", { name: /התחברות/ });
    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByText("studio-marker")).toBeInTheDocument();
    });
  });

  it("shows an inline error on wrong credentials", async () => {
    mockProbe(false);
    mockLogin({ success: false, error: "Invalid credentials" });
    render(
      <EditorLoginGate>
        <div>studio-marker</div>
      </EditorLoginGate>,
    );
    const passwordInput = await screen.findByLabelText("סיסמה");
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /התחברות/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid credentials");
    });
    expect(screen.queryByText("studio-marker")).toBeNull();
  });
});
