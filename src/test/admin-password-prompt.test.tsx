import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminPasswordPrompt } from "@/client/components/studio/settings/AdminPasswordPrompt";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockVerify(ok: boolean) {
  (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
    async () => new Response(JSON.stringify({ ok }), { status: 200 }),
  );
}

describe("AdminPasswordPrompt", () => {
  it("calls onUnlocked when the verify route returns { ok: true }", async () => {
    const onUnlocked = vi.fn();
    mockVerify(true);
    render(<AdminPasswordPrompt onUnlocked={onUnlocked} />);
    fireEvent.change(screen.getByLabelText("סיסמת מנהל"), {
      target: { value: "right-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /פתח/ }));
    await waitFor(() => {
      expect(onUnlocked).toHaveBeenCalledTimes(1);
    });
  });

  it("shows an inline error and does not call onUnlocked on a wrong password", async () => {
    const onUnlocked = vi.fn();
    mockVerify(false);
    render(<AdminPasswordPrompt onUnlocked={onUnlocked} />);
    fireEvent.change(screen.getByLabelText("סיסמת מנהל"), {
      target: { value: "wrong-pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /פתח/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("סיסמה שגויה");
    });
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("disables submit while the password field is empty", () => {
    render(<AdminPasswordPrompt onUnlocked={vi.fn()} />);
    const submit = screen.getByRole("button", { name: /פתח/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("סיסמת מנהל"), {
      target: { value: "x" },
    });
    expect(submit).not.toBeDisabled();
  });
});
