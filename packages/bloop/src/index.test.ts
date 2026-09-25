import { describe, expect, it } from "vitest";
import { bloopFeatures, bloopSvg } from "./index";

describe("@crewly/bloop", () => {
  it("is deterministic and normalizes the seed", () => {
    expect(bloopFeatures(" Ada ", "user")).toEqual(bloopFeatures("ada", "user"));
    expect(bloopSvg("Ada", "user")).toBe(bloopSvg("ada", "user"));
  });

  it("keeps user and agent output visibly distinct", () => {
    expect(bloopSvg("same", "agent")).toContain("bloop-agent");
    expect(bloopSvg("same", "agent")).toContain("bloop-antenna");
    expect(bloopSvg("same", "user")).toContain("bloop-user");
    expect(bloopSvg("same", "user")).not.toContain("bloop-antenna");
  });
});
