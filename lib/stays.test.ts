import { describe, expect, it } from "vitest";
import { nightsOf, stayColorIndex } from "./stays";
import { tripWith } from "./testUtils";
import type { Item } from "./types";

const stay = (id: string, nights: number, title = id): Item => ({ id, type: "stay", title, stay: { nights } });
const place = (id: string): Item => ({ id, type: "place", title: id });
const flight = (id: string, startTime?: string): Item => ({
  id,
  type: "transport",
  title: id,
  startTime,
  transport: { kind: "flight" },
});

describe("nightsOf", () => {
  it("numbers every night of a multi-night stay", () => {
    const trip = tripWith([[stay("hotel", 3)], [place("a")], [], [place("b")]]);
    expect(nightsOf(trip).map((n) => (n.kind === "stay" ? `${n.stay.id} ${n.night}/${n.nights}` : n.kind))).toEqual([
      "hotel 1/3",
      "hotel 2/3",
      "hotel 3/3",
      "end",
    ]);
  });

  it("flags nights without a stay and recognises overnight transport", () => {
    const trip = tripWith([[flight("out")], [flight("connection", "01:40")], [place("a")], [place("b")], []]);
    expect(nightsOf(trip).map((n) => n.kind)).toEqual(["transport", "transport", "none", "none", "end"]);
  });

  it("gives the same colour to stays with the same name", () => {
    const trip = tripWith([[stay("a", 1, "Hongkhao")], [stay("b", 1, "Pai")], [stay("c", 1, "Hongkhao ")], []]);
    const slots = stayColorIndex(nightsOf(trip));
    expect([...slots.entries()]).toEqual([
      ["hongkhao", 0],
      ["pai", 1],
    ]);
  });
});
