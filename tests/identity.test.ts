import { describe, expect, it } from "vitest";
import {
  resolveClub,
  resolvePlayer,
  normalizeSeason,
  posToGroup,
  slugify,
  stripDisambiguation,
} from "../lib/identity/normalize";

describe("club normalization", () => {
  it("maps era variants of the same club to one id", () => {
    expect(resolveClub("Real Madrid CF").clubId).toBe("real-madrid");
    expect(resolveClub("Real Madrid C.F.").clubId).toBe("real-madrid");
    expect(resolveClub("Real Madrid").clubId).toBe("real-madrid");
  });

  it("keeps historical names as canonical entities with aliases", () => {
    expect(resolveClub("FC Steaua București").clubId).toBe("steaua-bucuresti");
    expect(resolveClub("CSA Steaua București").clubId).toBe("steaua-bucuresti");
    expect(resolveClub("FK Crvena zvezda").clubId).toBe("red-star-belgrade");
    expect(resolveClub("Red Star Belgrade").clubId).toBe("red-star-belgrade");
  });

  it("resolves curated finalists with country", () => {
    const r = resolveClub("A.C. Milan");
    expect(r.clubId).toBe("milan");
    expect(r.country).toBe("Italy");
    expect(r.matchedVia).toBe("alias-map");
  });

  it("falls back gracefully for unknown clubs", () => {
    const r = resolveClub("FC Random Obscure 1907");
    expect(r.matchedVia).toBe("fallback");
    expect(r.clubId.length).toBeGreaterThan(0);
  });
});

describe("player normalization", () => {
  it("uses wikilink target as identity", () => {
    const a = resolvePlayer("Marquitos (footballer, born 1933)", "Marquitos");
    expect(a.playerId).toBe("p-marquitos-footballer-born-1933");
    expect(a.displayName).toBe("Marquitos");
    expect(a.identityEvidence).toBe("wikilink");
  });

  it("keeps same-name players separate when evidence separates them", () => {
    const a = resolvePlayer("Juan Alonso (footballer, born 1927)", "Juan Alonso");
    const b = resolvePlayer("Juan Alonso (footballer, born 1990)", "Juan Alonso");
    expect(a.playerId).not.toEqual(b.playerId);
  });

  it("unifies the same player across seasons via wiki title", () => {
    const a = resolvePlayer("Cristiano Ronaldo", "Cristiano Ronaldo");
    const b = resolvePlayer("Cristiano Ronaldo", "Ronaldo");
    expect(a.playerId).toEqual(b.playerId);
  });

  it("handles diacritics deterministically", () => {
    expect(resolvePlayer("Alfredo Di Stéfano", "Di Stéfano").playerId).toBe("p-alfredo-di-stefano");
    expect(slugify("José María Zárraga")).toBe("jose-maria-zarraga");
  });
});

describe("season + position", () => {
  it("normalizes seasons incl. century crossings", () => {
    expect(normalizeSeason("1955–56")).toEqual({ seasonId: "1955-56", endYear: 1956 });
    expect(normalizeSeason("1999–2000")).toEqual({ seasonId: "1999-00", endYear: 2000 });
    expect(normalizeSeason("2024–25")).toEqual({ seasonId: "2024-25", endYear: 2025 });
  });

  it("maps WM-era position codes", () => {
    expect(posToGroup("IR").group).toBe("FW");
    expect(posToGroup("OL").group).toBe("FW");
    expect(posToGroup("RH").group).toBe("MF");
    expect(posToGroup("CH").confident).toBe(false);
    expect(posToGroup("GK").group).toBe("GK");
  });

  it("strips wiki disambiguation", () => {
    expect(stripDisambiguation("Erwin Stein (footballer)")).toBe("Erwin Stein");
  });
});
