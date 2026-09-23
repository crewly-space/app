import { describe, expect, it } from "vitest";
import { BLOOP_TONES, bloopFeatures, bloopSvg } from "../src/ui/bloop";

describe("Bloop", () => {
  it("draws the same seed the same way every time", () => {
    expect(bloopSvg("usr_42", "user")).toBe(bloopSvg("usr_42", "user"));
    expect(bloopSvg("Maya", "agent")).toBe(bloopSvg("  maya ", "agent"));
  });

  it("gives different seeds different Bloops", () => {
    const drawn = new Set(["usr_1", "usr_2", "usr_3", "usr_4", "usr_5"].map((seed) => bloopSvg(seed, "user")));
    expect(drawn.size).toBe(5);
  });

  it("spreads seeds across every tone", () => {
    const tones = new Set(Array.from({ length: 200 }, (_, index) => bloopFeatures(`seed-${index}`, "user").tone));
    expect(tones.size).toBe(BLOOP_TONES);
  });

  it("marks an agent so it is never mistaken for a person", () => {
    const agent = bloopSvg("Maya", "agent");
    const person = bloopSvg("Maya", "user");
    expect(agent).toContain("bloop-agent");
    expect(agent).toContain("bloop-antenna");
    expect(person).toContain("bloop-user");
    expect(person).not.toContain("bloop-antenna");
  });

  it("is a closed svg with no raw colours and none of the seed's text", () => {
    const hostile = '"><script>alert(1)</script>';
    for (const kind of ["user", "agent"] as const) {
      const svg = bloopSvg(hostile, kind);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain("bloop-body");
      expect(svg).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
      expect(svg).not.toContain("script");
    }
  });
});
