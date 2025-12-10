import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

type MatchRow = {
  match_id: number;
  start_date: string;
  end_date: string;
  tournament_id: number;
  tournament_name: string;
  stage_name?: string;
  bo_type: number;
  tier: string;
  tier_rank: number;
  team1_id: number;
  team1_name: string;
  team1_score_bo: number;
  team2_id: number;
  team2_name: string;
  team2_score_bo: number;
  winner_team_id: number;
  winner_name: string;
  loser_team_id: number;
  loser_name: string;
  _ts?: number; // timestamp interne
};

type MapRow = {
  match_id: number;
  map_id: number;
  map_number: number;
  map_name: string;
  rounds_count: number;
  team1_name: string;
  team2_name: string;
  map_winner_name: string;
  map_winner_score: number;
  map_loser_name: string;
  map_loser_score: number;
};

type PickPerMap = { map_name: string; count: number };
type BoResult = { label: string; count: number };

type MapStats = {
  map_name: string;
  matches: number;
  avgDiff: number;
  closePct: number;
  stompPct: number;
  otPct: number;
};

type TeamStats = {
  team_name: string;
  bestMap: string;
  bestMapMatches: number;
  bestMapWinrateLabel: string;
  totalMatches: number;
  matchesWon: number;
};

type CsvState = {
  loading: boolean;
  error?: string;
  matches: MatchRow[];
  maps: MapRow[];
  maxDate: Date | null;
};

type StatsResult = {
  totalMatches: number;
  totalMaps: number;
  trackedTeams: number;
  pickPerMap: PickPerMap[];
  boResults: BoResult[];
  mapStats: MapStats[];
  topTeams: TeamStats[];
};

const matchesCsvUrl = new URL(
  './data/csv/matches10122025.csv',
  import.meta.url,
).href;
const mapsCsvUrl = new URL(
  './data/csv/maps10122025.csv',
  import.meta.url,
).href;

// Charge les CSV une seule fois
function useCsvData(): CsvState {
  const [state, setState] = useState<CsvState>({
    loading: true,
    matches: [],
    maps: [],
    maxDate: null,
  });

  useEffect(() => {
    async function load() {
      try {
        const [matchesResult, mapsResult] = await Promise.all([
          new Promise<Papa.ParseResult<MatchRow>>((resolve, reject) => {
            Papa.parse<MatchRow>(matchesCsvUrl, {
              download: true,
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
              complete: resolve,
              error: reject,
            });
          }),
          new Promise<Papa.ParseResult<MapRow>>((resolve, reject) => {
            Papa.parse<MapRow>(mapsCsvUrl, {
              download: true,
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
              complete: resolve,
              error: reject,
            });
          }),
        ]);

        // Tier S uniquement
        let matches = (matchesResult.data || []).filter(
          (m) => m && m.tier === 's',
        );
        const maps = (mapsResult.data || []).filter(
          (m) => m && m.map_name && m.map_winner_score != null,
        );

        // start_date -> timestamp
        matches = matches
          .map((m) => {
            const ts = Date.parse(m.start_date);
            return {
              ...m,
              _ts: Number.isNaN(ts) ? undefined : ts,
            };
          })
          .filter((m) => m._ts !== undefined);

        const maxTs = matches.length
          ? Math.max(...matches.map((m) => m._ts as number))
          : undefined;
        const maxDate = maxTs ? new Date(maxTs) : null;

        setState({
          loading: false,
          matches,
          maps,
          maxDate,
        });
      } catch (e) {
        console.error(e);
        setState((prev) => ({
          ...prev,
          loading: false,
          error: 'Erreur lors du chargement des CSV',
        }));
      }
    }

    load();
  }, []);

  return state;
}

// Calcule toutes les stats (comme PowerBI) sur un sous-ensemble matches/maps
function computeStats(matches: MatchRow[], maps: MapRow[]): StatsResult {
  const totalMatches = matches.length;
  const totalMaps = maps.length;

  // Équipes distinctes
  const teamSet = new Set<string>();
  matches.forEach((m) => {
    if (m.team1_name) teamSet.add(m.team1_name);
    if (m.team2_name) teamSet.add(m.team2_name);
  });
  const trackedTeams = teamSet.size;

  // Join maps + matches
  const matchesById = new Map<number, MatchRow>();
  matches.forEach((m) => matchesById.set(m.match_id, m));
  const mapsWithMatch = maps.map((map) => ({
    ...map,
    match: matchesById.get(map.match_id),
  }));

  // Pick par map
  const pickMapCount = new Map<string, number>();
  for (const m of mapsWithMatch) {
    pickMapCount.set(m.map_name, (pickMapCount.get(m.map_name) || 0) + 1);
  }
  const pickPerMap: PickPerMap[] = Array.from(pickMapCount.entries())
    .map(([map_name, count]) => ({ map_name, count }))
    .sort((a, b) => b.count - a.count);

  // Résultat BO
  const boCounter = new Map<string, number>();
  for (const m of matches) {
    const s1 = Number(m.team1_score_bo);
    const s2 = Number(m.team2_score_bo);
    if (isNaN(s1) || isNaN(s2)) continue;
    const winnerScore = Math.max(s1, s2);
    const loserScore = Math.min(s1, s2);
    const label = `${winnerScore}-${loserScore}`;
    boCounter.set(label, (boCounter.get(label) || 0) + 1);
  }
  const boResults: BoResult[] = Array.from(boCounter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Stats par map
  const byMap = new Map<string, MapRow[]>();
  for (const m of mapsWithMatch) {
    if (!byMap.has(m.map_name)) byMap.set(m.map_name, []);
    byMap.get(m.map_name)!.push(m);
  }

  const mapStats: MapStats[] = Array.from(byMap.entries())
    .map(([map_name, rows]) => {
      const diffs: number[] = [];
      let closeCount = 0;
      let stompCount = 0;
      let otCount = 0;

      for (const r of rows) {
        const w = Number(r.map_winner_score);
        const l = Number(r.map_loser_score);
        if (isNaN(w) || isNaN(l)) continue;
        const diff = Math.abs(w - l);
        diffs.push(diff);

        if (diff <= 2) closeCount += 1; // match serré
        if (diff >= 6) stompCount += 1; // stomp
        if (w > 13) otCount += 1; // overtime
      }

      const matchesCount = rows.length || 1;
      const avgDiff =
        diffs.reduce((s, v) => s + v, 0) / (diffs.length || 1);

      return {
        map_name,
        matches: matchesCount,
        avgDiff,
        closePct: (closeCount / matchesCount) * 100,
        stompPct: (stompCount / matchesCount) * 100,
        otPct: (otCount / matchesCount) * 100,
      };
    })
    .sort((a, b) => b.matches - a.matches);

  // Top 5 monde
  const teamIdByName = new Map<string, number>();
  for (const m of matches) {
    if (!teamIdByName.has(m.team1_name)) {
      teamIdByName.set(m.team1_name, m.team1_id);
    }
    if (!teamIdByName.has(m.team2_name)) {
      teamIdByName.set(m.team2_name, m.team2_id);
    }
  }

  const teamStats: TeamStats[] = [];

  for (const [team_name, team_id] of teamIdByName.entries()) {
    const teamMatches = matches.filter(
      (m) => m.team1_id === team_id || m.team2_id === team_id,
    );
    if (!teamMatches.length) continue;

    const totalTeamMatches = teamMatches.length;
    const matchesWon = teamMatches.filter(
      (m) => m.winner_team_id === team_id,
    ).length;

    const teamMaps = mapsWithMatch.filter(
      (m) => m.team1_name === team_name || m.team2_name === team_name,
    );
    if (!teamMaps.length) continue;

    const mapsByName = new Map<string, MapRow[]>();
    for (const r of teamMaps) {
      if (!mapsByName.has(r.map_name)) mapsByName.set(r.map_name, []);
      mapsByName.get(r.map_name)!.push(r);
    }

    let bestMap = '';
    let bestMapMatches = 0;
    let bestWins = 0;
    let bestWinrate = 0;

    for (const [map_name, rows] of mapsByName.entries()) {
      const played = rows.length;
      const winsOnMap = rows.filter((r) =>
        (r.map_winner_name || '')
          .toLowerCase()
          .includes(team_name.toLowerCase()),
      ).length;
      const wr = played ? winsOnMap / played : 0;

      if (
        wr > bestWinrate ||
        (wr === bestWinrate && played > bestMapMatches)
      ) {
        bestMap = map_name;
        bestMapMatches = played;
        bestWins = winsOnMap;
        bestWinrate = wr;
      }
    }

    let label = 'Aucune victoire';
    if (bestMapMatches > 0 && bestWins > 0) {
      if (bestWins === bestMapMatches) {
        label = '100,0 %';
      } else {
        label = `${(bestWinrate * 100).toFixed(1)} %`;
      }
    }

    teamStats.push({
      team_name,
      bestMap,
      bestMapMatches,
      bestMapWinrateLabel: label,
      totalMatches: totalTeamMatches,
      matchesWon,
    });
  }

  const topTeams = teamStats
    .sort((a, b) => b.totalMatches - a.totalMatches)
    .slice(0, 5);

  return {
    totalMatches,
    totalMaps,
    trackedTeams,
    pickPerMap,
    boResults,
    mapStats,
    topTeams,
  };
}

const StatCard: React.FC<{ title: string; value: string | number }> = ({
  title,
  value,
}) => (
  <div className="flex-1 rounded-2xl bg-white shadow-sm px-6 py-4 border border-slate-100">
    <div className="text-xs font-semibold uppercase text-slate-400">
      {title}
    </div>
    <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
  </div>
);

const App: React.FC = () => {
  const { loading, error, matches, maps, maxDate } = useCsvData();
  const [lookbackDays, setLookbackDays] = useState<number>(30);

  let stats: StatsResult | null = null;
  let fromDate: Date | null = null;

  if (!loading && !error && matches.length && maps.length && maxDate) {
    const cutoffTs =
      maxDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
    fromDate = new Date(cutoffTs);

    const filteredMatches = matches.filter(
      (m) => (m._ts as number) >= cutoffTs,
    );
    const allowedIds = new Set(filteredMatches.map((m) => m.match_id));
    const filteredMaps = maps.filter((mp) => allowedIds.has(mp.match_id));

    stats = computeStats(filteredMatches, filteredMaps);
  }

  const dateRangeLabel =
    fromDate && maxDate
      ? `Du ${fromDate.toLocaleDateString()} au ${maxDate.toLocaleDateString()}`
      : '';

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white shadow-sm border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10">
                <span className="text-primary text-lg">📊</span>
              </span>
              CS2 Pro Scene Statistics
            </h1>
            <p className="text-sm text-slate-500">
              Analyse complète des performances de la scène compétitive (Tier S).
            </p>
          </div>
          <span className="hidden sm:inline-flex text-xs px-3 py-1 rounded-full bg-accent/10 text-accent font-semibold">
            Powered by .csv &amp; React
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-10 pt-6 space-y-6">
        {loading && (
          <div className="text-center text-slate-500 mt-10">
            Chargement des données CSV...
          </div>
        )}
        {error && (
          <div className="text-center text-red-500 mt-4">{error}</div>
        )}

        {!loading && !error && stats && (
          <>
            {/* Slider de période */}
            <section className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-800">
                  Période analysée
                </div>
                <div className="text-xs text-slate-500">
                  {dateRangeLabel || 'En attente de données...'}
                </div>
              </div>
              <div className="w-full max-w-xs">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Derniers {lookbackDays} jours</span>
                  <span>7 – 365</span>
                </div>
                <input
                  type="range"
                  min={7}
                  max={365}
                  value={lookbackDays}
                  onChange={(e) =>
                    setLookbackDays(Number(e.target.value))
                  }
                  className="w-full"
                />
              </div>
            </section>

            {/* Cartes */}
            <section className="grid sm:grid-cols-3 gap-4">
              <StatCard
                title="Total Matches"
                value={stats.totalMatches}
              />
              <StatCard
                title="Maps analysées"
                value={stats.totalMaps}
              />
              <StatCard
                title="Équipes trackées"
                value={stats.trackedTeams}
              />
            </section>

            {/* Graphs */}
            <section className="grid lg:grid-cols-2 gap-6">
              <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4">
                <h2 className="text-lg font-semibold mb-2 text-slate-800">
                  Pick par Map
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={stats.pickPerMap}
                      margin={{ top: 10, right: 20, left: 40, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="map_name" type="category" />
                      <Tooltip />
                      <Bar dataKey="count" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4">
                <h2 className="text-lg font-semibold mb-2 text-slate-800">
                  Résultat Best-of
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.boResults}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Tableaux */}
            <section className="space-y-6">
              <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4">
                <h2 className="text-lg font-semibold mb-4 text-slate-800">
                  Statistiques détaillées par Map
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                        <th className="px-3 py-2 text-left">map_name</th>
                        <th className="px-3 py-2 text-right">
                          Matches par Map
                        </th>
                        <th className="px-3 py-2 text-right">
                          Moyenne de Diff Rounds
                        </th>
                        <th className="px-3 py-2 text-right">
                          % Matches serrés
                        </th>
                        <th className="px-3 py-2 text-right">
                          % Stomps
                        </th>
                        <th className="px-3 py-2 text-right">
                          % OverTime
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.mapStats.map((m) => (
                        <tr
                          key={m.map_name}
                          className="odd:bg-white even:bg-slate-50/60"
                        >
                          <td className="px-3 py-2 font-medium">
                            {m.map_name}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.matches}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.avgDiff.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.closePct.toFixed(2)} %
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.stompPct.toFixed(2)} %
                          </td>
                          <td className="px-3 py-2 text-right">
                            {m.otPct.toFixed(2)} %
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl bg-white shadow-sm border border-slate-100 p-4">
                <h2 className="text-lg font-semibold mb-4 text-slate-800">
                  Top 5 Monde
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                        <th className="px-3 py-2 text-left">team_name</th>
                        <th className="px-3 py-2 text-left">BestMap</th>
                        <th className="px-3 py-2 text-left">
                          BestMapWinrate_Label
                        </th>
                        <th className="px-3 py-2 text-right">
                          BestMapMatches
                        </th>
                        <th className="px-3 py-2 text-right">
                          TotalMatchesPlayed
                        </th>
                        <th className="px-3 py-2 text-right">
                          MatchesWon
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.topTeams.map((t) => (
                        <tr
                          key={t.team_name}
                          className="odd:bg-white even:bg-slate-50/60"
                        >
                          <td className="px-3 py-2 font-medium">
                            {t.team_name}
                          </td>
                          <td className="px-3 py-2">{t.bestMap}</td>
                          <td className="px-3 py-2">
                            {t.bestMapWinrateLabel}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {t.bestMapMatches}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {t.totalMatches}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {t.matchesWon}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default App;
