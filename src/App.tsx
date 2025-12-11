import React, { useEffect, useState } from 'react';
import Papa from 'papaparse';
import type { ParseResult } from 'papaparse';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// ---------- Types de base ----------

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

type StatsResult = {
  totalMatches: number;
  totalMaps: number;
  trackedTeams: number;
  pickPerMap: PickPerMap[];
  boResults: BoResult[];
  mapStats: MapStats[];
  teamStats: TeamStats[];
};

type Top5Ranking = {
  rank: number;
  team_name: string;
};

type Top5CsvRow = {
  rank: number | string;
  team_name: string;
};

// ---------- Chemins CSV (dossier public) ----------

const matchesCsvUrl = '/data/csv/matches10122025.csv';
const mapsCsvUrl = '/data/csv/maps10122025.csv';
const top5CsvUrl = '/data/csv/top5.csv';

// Couleurs en dégradé pour les maps (première = la plus claire)
const mapBarColors: string[] = [
  '#f97316',
  '#ea580c',
  '#c2410c',
  '#9a3412',
  '#7c2d12',
  '#5a1f0c',
  '#431407',
];

// ---------- Petit composant StatCard ----------

const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
}> = ({ title, value, icon }) => (
  <div className="flex-1 min-w-[180px] rounded-2xl bg-slate-900 shadow-md border border-slate-800 px-6 py-4 flex items-center gap-4">
    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 text-xl">
      {icon}
    </div>
    <div className="flex flex-col">
      <div className="text-xs font-semibold uppercase text-slate-400">
        {title}
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-50">{value}</div>
    </div>
  </div>
);

// ---------- Composant principal ----------

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [top5Rankings, setTop5Rankings] = useState<Top5Ranking[]>([]);
  const [lookbackDays, setLookbackDays] = useState<number>(30);

  // 1) Chargement des 3 CSV
  useEffect(() => {
    async function load() {
      try {
        const [matchesResult, mapsResult, top5Result]: [
          ParseResult<MatchRow>,
          ParseResult<MapRow>,
          ParseResult<Top5CsvRow>
        ] = await Promise.all([
          new Promise<ParseResult<MatchRow>>((resolve, reject) => {
            Papa.parse<MatchRow>(matchesCsvUrl, {
              download: true,
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
              complete: (result) => resolve(result),
              error: (err) => reject(err),
            });
          }),
          new Promise<ParseResult<MapRow>>((resolve, reject) => {
            Papa.parse<MapRow>(mapsCsvUrl, {
              download: true,
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
              complete: (result) => resolve(result),
              error: (err) => reject(err),
            });
          }),
          new Promise<ParseResult<Top5CsvRow>>((resolve, reject) => {
            Papa.parse<Top5CsvRow>(top5CsvUrl, {
              download: true,
              header: true,
              dynamicTyping: true,
              skipEmptyLines: true,
              complete: (result) => resolve(result),
              error: (err) => reject(err),
            });
          }),
        ]);

        const matchRows = matchesResult.data ?? [];
        const mapRows = mapsResult.data ?? [];
        const top5Rows = top5Result.data ?? [];

        const m = matchRows.filter((row) => {
          const tier = String(row.tier ?? '').toLowerCase();
          return tier === 's';
        });

        const mp = mapRows.filter(
          (row) => row.map_name && row.map_winner_score !== undefined,
        );

        console.log(
          'CSV chargés → matches tier S:',
          m.length,
          'maps:',
          mp.length,
        );

        const filteredTop5Rows = top5Rows.filter(
          (row): row is Top5CsvRow =>
            row !== null && typeof row.team_name === 'string',
        );

        const top5: Top5Ranking[] = filteredTop5Rows
          .map((row) => {
            const rankValue =
              typeof row.rank === 'string'
                ? Number.parseInt(row.rank, 10) || 0
                : row.rank ?? 0;

            return {
              rank: rankValue,
              team_name: row.team_name,
            };
          })
          .sort((a, b) => a.rank - b.rank);

        console.log('Top5.csv →', top5);

        setMatches(m);
        setMaps(mp);
        setTop5Rankings(top5);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setError('Erreur lors du chargement des CSV');
        setLoading(false);
      }
    }

    load();
  }, []);

  // 2) Dériver les stats, la fenêtre temporelle, et les équipes du top5 à afficher
  let stats: StatsResult | null = null;
  let dateRangeLabel = 'Toutes les données disponibles';
  let sliderMin = 1;
  let sliderMax = 1;
  let effectiveLookback = lookbackDays;
  let top5Display: TeamStats[] = [];

  if (!loading && !error && matches.length > 0 && maps.length > 0) {
    const timestamps = matches
      .map((m) => new Date(m.start_date).getTime())
      .filter((ts) => !Number.isNaN(ts));

    if (timestamps.length > 0) {
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const minDate = new Date(minTs);
      const maxDate = new Date(maxTs);

      const totalDays = Math.max(
        1,
        Math.round((maxTs - minTs) / (24 * 60 * 60 * 1000)),
      );

      sliderMax = totalDays;
      sliderMin = totalDays >= 7 ? 7 : 1;

      effectiveLookback = Math.min(
        Math.max(lookbackDays, sliderMin),
        sliderMax,
      );

      const cutoffTs = maxTs - effectiveLookback * 24 * 60 * 60 * 1000;
      const fromDate = new Date(cutoffTs);

      const filteredMatches = matches.filter((m) => {
        const ts = new Date(m.start_date).getTime();
        return !Number.isNaN(ts) && ts >= cutoffTs;
      });

      const allowedIds = new Set(filteredMatches.map((m) => m.match_id));
      const filteredMaps = maps.filter((mpRow) =>
        allowedIds.has(mpRow.match_id),
      );

      console.log(
        'Filtré → matches:',
        filteredMatches.length,
        'maps:',
        filteredMaps.length,
      );

      if (filteredMatches.length > 0 && filteredMaps.length > 0) {
        stats = computeStats(filteredMatches, filteredMaps);
        dateRangeLabel = `Du ${fromDate.toLocaleDateString()} au ${maxDate.toLocaleDateString()}`;
      } else {
        stats = computeStats(matches, maps);
        dateRangeLabel = `Du ${minDate.toLocaleDateString()} au ${maxDate.toLocaleDateString()} (fenêtre trop petite, affichage complet)`;
      }

      if (stats) {
        const byName = new Map<string, TeamStats>(
          stats.teamStats.map((t) => [t.team_name.toLowerCase(), t]),
        );

        if (top5Rankings.length > 0) {
          top5Display = top5Rankings
            .map((ranking) =>
              byName.get(ranking.team_name.toLowerCase()),
            )
            .filter((team): team is TeamStats => team !== undefined);
        } else {
          top5Display = [...stats.teamStats]
            .sort((a, b) => b.totalMatches - a.totalMatches)
            .slice(0, 5);
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-cs2-animated text-slate-100">
      {/* HEADER */}
      <header className="bg-gradient-to-b from-slate-950/80 via-slate-950/60 to-slate-950/0 border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-slate-100 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-500 text-slate-900 text-2xl shadow-lg">
              📈
            </span>
            <span>
              playSURE <span className="text-orange-400">CS2</span> Pro Stats
            </span>
          </h1>
          <p className="mt-2 text-sm text-slate-300 max-w-xl">
            Analyse complète des performances et statistiques de la scène
            compétitive (Tier S), générée automatiquement depuis les fichiers
            CSV.
          </p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-10 space-y-6 -mt-6 relative">
        {loading && (
          <div className="text-center text-slate-300 mt-10">
            Chargement des données CSV...
          </div>
        )}

        {error && (
          <div className="text-center text-red-400 mt-10">{error}</div>
        )}

        {!loading && !error && stats && (
          <>
            {/* Slider période */}
            <section className="rounded-2xl bg-slate-950/90 shadow-md border border-slate-800 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between backdrop-blur-sm">
              <div>
                <div className="text-sm font-semibold text-slate-100">
                  Période analysée
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  {dateRangeLabel}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Fenêtre glissante sur la plage de dates réelle des matchs.
                </div>
              </div>
              <div className="w-full max-w-sm">
                <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                  <span>Derniers {effectiveLookback} jours</span>
                  <span>
                    {sliderMin} – {sliderMax} jours
                  </span>
                </div>
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  value={effectiveLookback}
                  onChange={(e) =>
                    setLookbackDays(Number(e.target.value))
                  }
                  className="w-full accent-orange-500 cursor-pointer history-slider"
                />
              </div>
            </section>

            {/* Cartes globales */}
            <section className="flex flex-wrap gap-4">
              <StatCard
                title="Total Matches"
                value={stats.totalMatches}
                icon="🏆"
              />
              <StatCard
                title="Maps analysées"
                value={stats.totalMaps}
                icon="🗺️"
              />
              <StatCard
                title="Équipes trackées"
                value={stats.trackedTeams}
                icon="📊"
              />
            </section>

            {/* Graphs */}
            <section className="grid lg:grid-cols-2 gap-6">
              {/* Pick par map */}
              <div className="rounded-2xl bg-slate-950/90 shadow-md border border-slate-800 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-2 text-slate-100 flex items-center gap-2">
                  <span className="h-1.5 w-6 rounded-full bg-orange-500" />
                  Pick par Map
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={stats.pickPerMap}
                      margin={{
                        top: 10,
                        right: 20,
                        left: 40,
                        bottom: 10,
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        type="number"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                      />
                      <YAxis
                        dataKey="map_name"
                        type="category"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                      />
                      <Tooltip
                      cursor={false}
                        contentStyle={{
                          backgroundColor: '#020617',
                          borderColor: '#1f2937',
                          color: '#e5e7eb',
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 4, 4]}>
                        {stats.pickPerMap.map((entry, index) => {
                          const colorIndex = Math.min(
                            index,
                            mapBarColors.length - 1,
                          );
                          return (
                            <Cell
                              key={entry.map_name}
                              fill={mapBarColors[colorIndex]}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Résultat Best-of */}
              <div className="rounded-2xl bg-slate-950/90 shadow-md border border-slate-800 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-2 text-slate-100 flex items-center gap-2">
                  <span className="h-1.5 w-6 rounded-full bg-[#0f766e]" />
                  Résultat Best-of
                </h2>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.boResults}>
                      <defs>
                        <linearGradient
                          id="boTealGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#0f766e" />
                          <stop offset="100%" stopColor="#022c22" />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        dataKey="label"
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke="#9ca3af"
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                      />
                      <Tooltip
                      cursor={false}
                        contentStyle={{
                          backgroundColor: '#020617',
                          borderColor: '#1f2937',
                          color: '#e5e7eb',
                          fontSize: 12,
                        }}
                      />
                      <Bar
                        dataKey="count"
                        fill="url(#boTealGradient)"
                        radius={[4, 4, 4, 4]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Tableaux */}
            <section className="space-y-6">
              {/* Maps détaillées */}
              <div className="rounded-2xl bg-slate-950/90 shadow-md border border-slate-800 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4 text-slate-100 flex items-center gap-2">
                  <span className="h-1.5 w-6 rounded-full bg-orange-500" />
                  Statistiques détaillées par Map
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-950 text-xs uppercase text-slate-400 border-b border-slate-700">
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
                        <th className="px-3 py-2 text-right">% Stomps</th>
                        <th className="px-3 py-2 text-right">
                          % Overtime
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.mapStats.map((m) => (
                        <tr
                          key={m.map_name}
                          className="odd:bg-slate-950 even:bg-slate-900/80"
                        >
                          <td className="px-3 py-2 font-medium text-slate-50">
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

              {/* Top 5 Monde */}
              <div className="rounded-2xl bg-slate-950/90 shadow-md border border-slate-800 p-5 backdrop-blur-sm">
                <h2 className="text-lg font-semibold mb-4 text-slate-100 flex items-center gap-2">
                  <span className="h-1.5 w-6 rounded-full bg-sky-500" />
                  Top 5 Monde #VALVE Ranking
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-950 text-xs uppercase text-slate-400 border-b border-slate-700">
                        <th className="px-3 py-2 text-left">Rang</th>
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
                      {top5Display.map((t, idx) => {
                        const ranking = top5Rankings.find(
                          (r) =>
                            r.team_name.toLowerCase() ===
                            t.team_name.toLowerCase(),
                        );
                        const rankFromCsv = ranking
                          ? ranking.rank
                          : idx + 1;

                        const rankLabel =
                          rankFromCsv === 1 ? '1er' : `${rankFromCsv}ème`;

                        let emoji = '';
                        let textLabel = '';
                        let badgeClass =
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide';

                        if (rankFromCsv === 1) {
                          emoji = '🥇';
                          textLabel = 'Or';
                          badgeClass +=
                            ' border-yellow-400 bg-yellow-500/10 text-yellow-300';
                        } else if (rankFromCsv === 2) {
                          emoji = '🥈';
                          textLabel = 'Argent';
                          badgeClass +=
                            ' border-slate-300 bg-slate-300/10 text-slate-200';
                        } else if (rankFromCsv === 3) {
                          emoji = '🥉';
                          textLabel = 'Bronze';
                          badgeClass +=
                            ' border-amber-500 bg-amber-600/10 text-amber-300';
                        } else if (rankFromCsv === 4) {
                          emoji = '⭐';
                          textLabel = 'Deciders';
                          badgeClass +=
                            ' border-teal-500 bg-teal-600/10 text-teal-300';
                        } else {
                          emoji = '⭐';
                          textLabel = 'Outsiders';
                          badgeClass +=
                            ' border-indigo-500 bg-indigo-600/10 text-indigo-300';
                        }

                        return (
                          <tr
                            key={t.team_name}
                            className="odd:bg-slate-950 even:bg-slate-900/80"
                          >
                            <td className="px-3 py-2">{rankLabel}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-3">
                                <span className={badgeClass}>
                                  <span className="text-sm leading-none">
                                    {emoji}
                                  </span>
                                  <span>{textLabel}</span>
                                </span>
                                <span className="font-medium text-slate-50">
                                  {t.team_name}
                                </span>
                              </div>
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}

        {!loading && !error && !stats && (
          <div className="text-center text-slate-300 mt-10">
            Aucune donnée exploitable trouvée dans les CSV.
          </div>
        )}
      </main>
    </div>
  );
};

// ---------- Fonctions de calcul à partir des CSV ----------

function computeStats(matches: MatchRow[], maps: MapRow[]): StatsResult {
  const totalMatches = matches.length;
  const totalMaps = maps.length;

  const teamSet = new Set<string>();
  matches.forEach((m) => {
    if (m.team1_name) teamSet.add(m.team1_name);
    if (m.team2_name) teamSet.add(m.team2_name);
  });
  const trackedTeams = teamSet.size;

  const matchesById = new Map<number, MatchRow>();
  matches.forEach((m) => matchesById.set(m.match_id, m));
  const mapsWithMatch = maps.map((map) => ({
    ...map,
    match: matchesById.get(map.match_id),
  }));

  const pickMapCount = new Map<string, number>();
  for (const m of mapsWithMatch) {
    pickMapCount.set(m.map_name, (pickMapCount.get(m.map_name) ?? 0) + 1);
  }
  const pickPerMap: PickPerMap[] = Array.from(pickMapCount.entries())
    .map(([map_name, count]) => ({ map_name, count }))
    .sort((a, b) => b.count - a.count);

  const boCounter = new Map<string, number>();
  for (const m of matches) {
    const s1 = Number(m.team1_score_bo);
    const s2 = Number(m.team2_score_bo);
    if (Number.isNaN(s1) || Number.isNaN(s2)) continue;
    const winnerScore = Math.max(s1, s2);
    const loserScore = Math.min(s1, s2);
    const label = `${winnerScore}-${loserScore}`;
    boCounter.set(label, (boCounter.get(label) ?? 0) + 1);
  }
  const boResults: BoResult[] = Array.from(boCounter.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

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
        if (Number.isNaN(w) || Number.isNaN(l)) continue;
        const diff = Math.abs(w - l);
        diffs.push(diff);
        if (diff <= 2) closeCount += 1;
        if (diff >= 6) stompCount += 1;
        if (w > 13) otCount += 1;
      }

      const matchesCount = rows.length || 1;
      const avgDiff =
        diffs.reduce((sum, value) => sum + value, 0) /
        (diffs.length || 1);

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
    if (teamMatches.length === 0) continue;

    const totalTeamMatches = teamMatches.length;
    const matchesWon = teamMatches.filter(
      (m) => m.winner_team_id === team_id,
    ).length;

    const teamMaps = mapsWithMatch.filter(
      (m) => m.team1_name === team_name || m.team2_name === team_name,
    );
    if (teamMaps.length === 0) continue;

    const mapsByName = new Map<string, MapRow[]>();
    for (const r of teamMaps) {
      if (!mapsByName.has(r.map_name)) mapsByName.set(r.map_name, []);
      mapsByName.get(r.map_name)!.push(r);
    }

    let bestMap = '';
    let bestMapMatches = 0;
    let bestMapWr = 0;

    for (const [map_name, rows] of mapsByName.entries()) {
      const played = rows.length;
      const winsOnMap = rows.filter((r) =>
        (r.map_winner_name ?? '')
          .toLowerCase()
          .includes(team_name.toLowerCase()),
      ).length;
      const wr = played > 0 ? winsOnMap / played : 0;

      if (wr > bestMapWr || (wr === bestMapWr && played > bestMapMatches)) {
        bestMap = map_name;
        bestMapMatches = played;
        bestMapWr = wr;
      }
    }

    let label = 'Aucune victoire';
    if (totalTeamMatches > 0 && matchesWon > 0) {
      const wrSeries = matchesWon / totalTeamMatches;
      label = `${(wrSeries * 100).toFixed(1)} %`;
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

  return {
    totalMatches,
    totalMaps,
    trackedTeams,
    pickPerMap,
    boResults,
    mapStats,
    teamStats,
  };
}

export default App;
