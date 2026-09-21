import { describe, expect, it } from "vitest";
import {
  CREW_VARIANTS,
  crewAvatarSvg,
  crewVariantFor,
} from "../src/ui/crew-avatar";

describe("crew avatar", () => {
  it("gives the same name the same face every time", () => {
    expect(crewVariantFor("Maya")).toBe(crewVariantFor("  maya "));
  });

  it("gives the agents shown on the website three different faces", () => {
    const faces = new Set(["Maya", "Linus", "Noa"].map(crewVariantFor));
    expect(faces.size).toBe(3);
  });

  it("draws every variant as a closed svg with the body and no raw colours", () => {
    for (const variant of CREW_VARIANTS) {
      const svg = crewAvatarSvg(variant);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain("crew-body");
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
    }
  });

  it("marks the reader's own avatar so it is not mistaken for an agent", () => {
    expect(crewAvatarSvg("plain", true)).toContain("is-you");
    expect(crewAvatarSvg("plain")).not.toContain("is-you");
  });
});
