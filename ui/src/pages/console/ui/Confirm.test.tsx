// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Confirm } from "./Confirm.js";

afterEach(cleanup);

function Harness({ busy = false, onCancel }: { busy?: boolean; onCancel: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Confirm
        open={open}
        title="Revoke the grant?"
        confirmLabel="Revoke"
        busy={busy}
        onConfirm={() => undefined}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      >
        <p>The account loses access.</p>
      </Confirm>
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByRole("alertdialog", { name: "Revoke the grant?" });
}

describe("Confirm", () => {
  it("puts focus on Cancel when it opens", async () => {
    const user = userEvent.setup();
    render(<Harness onCancel={vi.fn()} />);
    await openDialog(user);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })));
  });

  it("cancels on Escape while idle", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await openDialog(user);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape and an outside press while busy", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness busy onCancel={onCancel} />);
    await openDialog(user);
    await user.keyboard("{Escape}");
    await user.click(document.body);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
  });

  it("ignores an outside press while idle", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} />);
    await openDialog(user);
    await user.click(document.body);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disables both buttons while busy", async () => {
    const user = userEvent.setup();
    render(<Harness busy onCancel={vi.fn()} />);
    await openDialog(user);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Working…" }).hasAttribute("disabled")).toBe(true);
  });
});
