import { describe, expect, it } from "vitest";
import { parseFinalPage, parseFinalsList } from "../scripts/clean/parsers";

const CLASSIC_PAGE = `
==Match==
{{Football box
|date=18 May 1960
|team1=[[Alpha FC]] {{fbaicon|ESP}}
|score=3–1
|team2={{fbaicon|FRG}} [[Beta SV]]
|goals1=*[[John Striker|Striker]] {{goal|10||55|pen.}} *[[Sam Wing|Wing]] {{goal|70}}
|goals2=*[[Karl Neun]] {{goal|80}}
|stadium=[[Neutral Park]]
}}
{| width=92%
|-
|{{Football kit|body=FFFFFF|title=Alpha FC}}
|{{Football kit|body=FF0000|title=Beta SV}}
|}
{| style="width:100%"
|-
|GK ||'''1''' ||{{flagicon|ESP}} [[Al Keeper]]
|-
|RB ||'''2''' ||{{flagicon|ESP}} [[B One]]
|-
|CB ||'''5''' ||{{flagicon|ESP}} [[B Two]]
|-
|LB ||'''3''' ||{{flagicon|ESP}} [[B Three]]
|-
|RH ||'''4''' ||{{flagicon|ESP}} [[M One]] ([[Captain (association football)|c]])
|-
|LH ||'''6''' ||{{flagicon|ESP}} [[M Two]]
|-
|OR ||'''7''' ||{{flagicon|ESP}} [[F One]]
|-
|IR ||'''8''' ||{{flagicon|ESP}} [[John Striker]]
|-
|CF ||'''9''' ||{{flagicon|ESP}} {{interlanguage link|Ill Niner|es}}
|-
|IL ||'''10'''||{{flagicon|ESP}} [[Sam Wing]]
|-
|OL ||'''11'''||{{flagicon|ESP}} [[F Four]]
|-
|colspan=3|'''Manager:'''
|-
|colspan=4|{{flagicon|ESP}} [[Coach Alpha]]
|}
{| style="font-size:90%"
|-
|GK ||'''1''' ||{{flagicon|FRG}} [[Beta Keeper]]
|-
|RB ||'''2''' ||{{flagicon|FRG}} [[C One]]
|-
|CB ||'''5''' ||{{flagicon|FRG}} [[C Two]]
|-
|LB ||'''3''' ||{{flagicon|FRG}} [[C Three]]
|-
|RH ||'''4''' ||{{flagicon|FRG}} [[N One]]
|-
|LH ||'''6''' ||{{flagicon|FRG}} [[N Two]]
|-
|OR ||'''7''' ||{{flagicon|FRG}} [[G One]]
|-
|IR ||'''8''' ||{{flagicon|FRG}} [[G Two]]
|-
|CF ||'''9''' ||{{flagicon|FRG}} [[Karl Neun]]
|-
|IL ||'''10'''||{{flagicon|FRG}} [[G Three]]
|-
|OL ||'''11'''||{{flagicon|FRG}} [[G Four]]
|-
|colspan=3|'''Manager:'''
|-
|colspan=4|{{flagicon|FRG}} [[Coach Beta]]
|}
`;

describe("parseFinalPage", () => {
  const parsed = parseFinalPage(CLASSIC_PAGE);

  it("extracts the football box", () => {
    expect(parsed.matches).toHaveLength(1);
    const m = parsed.matches[0];
    expect(m.team1Link).toBe("Alpha FC");
    expect(m.team2Link).toBe("Beta SV");
    expect(m.score).toBe("3–1");
  });

  it("extracts goals with minutes and penalty flags", () => {
    const goals = parsed.matches[0].goals;
    expect(goals).toHaveLength(4);
    const pen = goals.find((g) => g.penalty);
    expect(pen?.scorerLink).toBe("John Striker");
    expect(pen?.minute).toBe("55");
    expect(goals.filter((g) => g.team === 2)).toHaveLength(1);
  });

  it("splits lineup blocks and pairs kits in classic layout", () => {
    expect(parsed.lineups).toHaveLength(2);
    expect(parsed.lineups[0].kitTitle).toBe("Alpha FC");
    expect(parsed.lineups[1].kitTitle).toBe("Beta SV");
    expect(parsed.lineups[0].players).toHaveLength(11);
    expect(parsed.lineups[1].players).toHaveLength(11);
  });

  it("captures captain, nationality, shirt and managers", () => {
    const captain = parsed.lineups[0].players.find((p) => p.captain);
    expect(captain?.displayName).toBe("M One");
    expect(parsed.lineups[0].players[0].nationality).toBe("ESP");
    expect(parsed.lineups[0].players[0].shirt).toBe(1);
    expect(parsed.lineups[0].manager).toBe("Coach Alpha");
  });

  it("keeps interlanguage-link players as name-only entries", () => {
    const ill = parsed.lineups[0].players.find((p) => p.displayName === "Ill Niner");
    expect(ill).toBeDefined();
    expect(ill?.linkTarget).toBeNull();
  });

  it("reports anomalies instead of guessing", () => {
    const broken = parseFinalPage("nothing here");
    expect(broken.anomalies.length).toBeGreaterThan(0);
  });
});

const LIST_SNIPPET = `
{| class="wikitable"
|-
!scope=col|Season
|-
!scope="row" style="text-align:center"|[[1955–56 European Cup|1955–56]]
|{{fba|ESP|1945|name=Spain}}
|[[Real Madrid CF|Real Madrid]]
|align=center|[[1956 European Cup final|4–3]]
|[[Stade de Reims|Reims]]
|{{fba|FRA|1830|name=France}}
|[[Parc des Princes]], Paris, France
|align=center|38,239
|-
!scope="row" style="text-align:center"|[[1992–93 UEFA Champions League|1992–93]]
|{{fba|FRA|name=France}}
|[[Olympique de Marseille|Marseille]]
|align=center|[[1993 UEFA Champions League final|1–0]]
|[[A.C. Milan|Milan]]
|{{fba|ITA|name=Italy}}
|[[Stade de Gerland]], Lyon, France
|align=center|64,400
|}
`;

describe("parseFinalsList", () => {
  it("parses rows across both competition eras", () => {
    const { rows } = parseFinalsList(LIST_SNIPPET);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      seasonRaw: "1955–56",
      competition: "EC",
      finalPage: "1956 European Cup final",
      winnerLink: "Real Madrid CF",
      runnerUpLink: "Stade de Reims",
      scoreText: "4–3",
      attendance: 38239,
    });
    expect(rows[1]).toMatchObject({
      competition: "UCL",
      winnerLink: "Olympique de Marseille",
      runnerUpLink: "A.C. Milan",
    });
  });
});
