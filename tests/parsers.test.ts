import { describe, expect, it } from "vitest";
import { parseFinalPage, parseFinalsList, parseSquadPage } from "../scripts/clean/parsers";

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

const SQUAD_PAGE_EFS = `
==Transfers==
Some transfer prose with [[Player Links]].
==Squad statistics==
{{Efs start|League|Cup|Champions League}}
{{Efs player|no=1 |name=[[Keeper One]]|pos=GK|nat=BRA |37|0|0|0|12|0}}
{{Efs player|no=4 |name=[[Centre Back]]|pos=DF|nat=NED |33|3|3|1|11|1}}
{{Efs player|no=10|name=[[Star Creator]]|pos=MF|nat=SRB |34|28|4|1|17+1|9}}
{{Efs player|no=9 |name=[[Fringe Striker]]|pos=FW|nat=ARG |1+1|0|1|0|0+1|0}}
{{Efs end}}
===Out on loan===
{{Efs player|no=99|name=[[Loaned Away]]|pos=FW|nat=GER |0|0|0|0|0|0}}
`;

const SQUAD_PAGE_FBSI = `
==Squad information==
{{fb si header |age=y}}
{{fb si player |bg=y |p=[[Old Keeper]] |eu=y |nb=CMR |n=1 |pos=GK |age={{Age|1984|2|18|2013|6|30}} |s=2012 |a=12 |g=0 }}
{{fb si player |p=[[Right Back]] |nb=ESP |n=2 |pos=RB |age={{Age|1985|1|10|2013|6|30}} |a=30 |g=1 }}
`;

const SQUAD_PAGE_SPLIT = `
==Squad==
{{Fs player|no=1 |nat=BRA|pos=GK|name=[[Keeper One]]}}
{{Fs player|no=4 |nat=NED|pos=DF|name=[[Centre Back]]}}
{{Fs player|no=10|nat=SRB|pos=MF|name=[[Star Creator]]}}
{{Fs player|no=29|nat=FRA|pos=FW|name=[[Young Breakout]]}}
{{Fs player|no=40|nat=FRA|pos=GK|name=[[Third Keeper]]}}
==Transfers==
prose
==Statistics==
===Appearances and goals===
{{Efs start|[[2016–17 Ligue 1|Ligue 1]]|[[Coupe de France]]|[[Coupe de la Ligue]]|[[2016–17 UEFA Champions League|Champions League]]}}
{{Efs player| no=1  |name=[[Keeper One]]|pos=GK|nat=BRA   |36|0|0|0|4|0|14|0}}
{{Efs player| no=4  |name=[[Centre Back]]|pos=DF|nat=NED  |33+1|2|2|0|1|0|13|1}}
{{Efs player2|no=10 |name=[[Star Creator]]|pos=MF|nat=SRB |34+3|8|2|1|2|0|15+1|3}}
{{Efs player| no=29 |name=[[Young Breakout]]|pos=FW|nat=FRA |14+15|15|2|2|3|4|6+3|6}}
{{Efs player| no=99 |name=[[Departed Mid Season]]|pos=FW|nat=GER |9|2|0|0|2|0|11|2}}
{{Efs end}}
`;

const SQUAD_PAGE_ZERO_EUROPE = `
==Squad==
{{Efs player|no=1 |name=[[Solid Keeper]]|pos=GK|nat=ITA |32|0|1|0|0|0|}}
{{Efs player|no=10|name=[[League Star]]|pos=MF|nat=ITA  |36|12|3|1|0|0|}}
{{Efs player|no=9 |name=[[League Striker]]|pos=FW|nat=ITA |30|18|4|2|0|0|}}
`;

describe("parseSquadPage", () => {
  const efs = parseSquadPage(SQUAD_PAGE_EFS);

  it("parses Efs squads with European apps/goals from the last stat pair", () => {
    expect(efs.hasSeasonStats).toBe(false); // <8 stat rows in fixture
    const star = efs.players.find((p) => p.displayName === "Star Creator")!;
    expect(star.continentalApps).toBe(18); // 17+1
    expect(star.continentalStarts).toBe(17);
    expect(star.continentalGoals).toBe(9);
    expect(star.leagueApps).toBe(34);
    expect(star.leagueGoals).toBe(28);
    const fringe = efs.players.find((p) => p.displayName === "Fringe Striker")!;
    expect(fringe.continentalApps).toBe(1); // 0+1
  });

  it("cuts off loan/reserve sections after the squad begins", () => {
    expect(efs.players.some((p) => p.displayName === "Loaned Away")).toBe(false);
    expect(efs.players).toHaveLength(4);
  });

  it("merges a separate appearances table into the squad list by named competition", () => {
    const split = parseSquadPage(SQUAD_PAGE_SPLIT);
    expect(split.players).toHaveLength(5);
    const young = split.players.find((p) => p.displayName === "Young Breakout")!;
    expect(young.continentalApps).toBe(9); // 6+3 from the Champions League pair
    expect(young.continentalStarts).toBe(6);
    expect(young.continentalGoals).toBe(6);
    expect(young.leagueApps).toBe(29); // 14+15 from the named Ligue 1 pair
    expect(young.leagueGoals).toBe(15);
    // {{Efs player2}} rows and leading-space params parse too
    const star = split.players.find((p) => p.displayName === "Star Creator")!;
    expect(star.continentalApps).toBe(16);
    expect(star.continentalGoals).toBe(3);
    // a stats row for a non-squad player is never added to the squad
    expect(split.players.some((p) => p.displayName === "Departed Mid Season")).toBe(false);
    // the third keeper has no stats row: stays null (handled as evidence downstream)
    expect(split.players.find((p) => p.displayName === "Third Keeper")!.continentalApps).toBeNull();
  });

  it("drops an all-zero European column as unreliable instead of treating it as evidence", () => {
    const zero = parseSquadPage(SQUAD_PAGE_ZERO_EUROPE);
    const star = zero.players.find((p) => p.displayName === "League Star")!;
    expect(star.continentalApps).toBeNull();
    expect(star.leagueApps).toBe(36); // domestic stats are kept
    expect(star.leagueGoals).toBe(12);
    expect(zero.anomalies.some((a) => a.includes("all zeros"))).toBe(true);
  });

  it("parses fb si squads with nested templates and specific position codes", () => {
    const fbsi = parseSquadPage(SQUAD_PAGE_FBSI);
    expect(fbsi.players).toHaveLength(2);
    expect(fbsi.players[0]).toMatchObject({ displayName: "Old Keeper", pos: "GK", nationality: "CMR", shirt: 1 });
    expect(fbsi.players[1].pos).toBe("RB");
    expect(fbsi.players[1].continentalApps).toBeNull(); // ambiguous scope: never guessed
  });

  it("reports anomalies for pages without squad templates", () => {
    const broken = parseSquadPage("== Nothing here ==");
    expect(broken.players).toHaveLength(0);
    expect(broken.anomalies).toContain("no squad-list templates found");
  });
});

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
