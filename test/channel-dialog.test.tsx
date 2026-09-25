// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChannelDialog } from "../src/features/channels/ChannelDialog";
import { gateway } from "../src/lib/gateway";

afterEach(() => vi.restoreAllMocks());

it("starts one channel mutation when create is double-clicked in one render turn", async () => {
  let resolve!: (value: never) => void;
  const create = vi.spyOn(gateway, "createChannel").mockImplementation(() => new Promise((finish) => {
    resolve = finish;
  }));
  const onSaved = vi.fn();
  render(
    <ChannelDialog
      channels={[]}
      categories={[]}
      agents={[]}
      people={[]}
      canManage
      onClose={vi.fn()}
      onSaved={onSaved}
      onLeft={vi.fn()}
    />
  );

  fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "general" } });
  const button = screen.getByRole("button", { name: "Create channel" });
  fireEvent.click(button);
  fireEvent.click(button);

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  resolve({ id: "channel-1", name: "general" } as never);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});
