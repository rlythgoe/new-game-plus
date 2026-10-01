import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://zrsyceorfasndxrpwqhd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZxDV4_n9VAJCYIQ2U5Cycg_p-QqY-PP";

const supabase = {
  from: (table) => ({
    insert: async (rows) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Prefer": "return=representation",
        },
        body: JSON.stringify(rows),
      });
      const data = await res.json();
      return { data, error: res.ok ? null : data };
    },
    select: async (columns = "*", opts = {}) => {
      let url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}`;
      if (opts.order) url += `&order=${opts.order}`;
      if (opts.filter) url += `&${opts.filter}`;
      const authHeaders = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      };

      // Caller wants a specific, deliberately-capped number of rows (e.g. "500
      // most recent games") — do a single plain request, no pagination needed.
      if (opts.limit) {
        const res = await fetch(`${url}&limit=${opts.limit}`, { headers: authHeaders });
        const data = await res.json();
        return { data: res.ok ? data : [], error: res.ok ? null : data };
      }

      // Otherwise fetch ALL rows. PostgREST (Supabase's REST API) caps every
      // response at its configured max-rows (commonly 1000) regardless of how
      // many rows actually match — a single request silently truncates once a
      // table grows past that, which is exactly what was undercounting the
      // Per-Player stats. Page through with the Range header until a page
      // comes back shorter than a full page, then stitch everything together.
      const PAGE_SIZE = 1000;
      let allRows = [];
      let from = 0;
      while (true) {
        const res = await fetch(url, {
          headers: { ...authHeaders, Range: `${from}-${from + PAGE_SIZE - 1}` },
        });
        if (!res.ok) {
          const errData = await res.json();
          return { data: allRows, error: errData };
        }
        const page = await res.json();
        allRows = allRows.concat(page);
        if (page.length < PAGE_SIZE) break; // last page reached
        from += PAGE_SIZE;
      }
      return { data: allRows, error: null };
    },

    increment: async (id) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_counter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ row_id: id }),
      });
      return { error: res.ok ? null : await res.json() };
    },
  }),
};

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

const ScratchBallSelector = ({ onSelectBall, label }) => {
  const [showPicker, setShowPicker] = useState(false);
  if (showPicker) {
    return (
      <div className="bg-red-800 p-3 rounded-lg">
        <div className="text-sm mb-2 font-semibold">{label} - Select Ball:</div>
        <div className="grid grid-cols-5 gap-1 mb-2">
          {Array.from({ length: 15 }, (_, i) => i + 1).map((ball) => (
            <button key={ball} onClick={() => { onSelectBall(ball); setShowPicker(false); }}
              className="bg-red-600 hover:bg-red-500 p-2 rounded text-sm font-semibold">
              {ball}
            </button>
          ))}
        </div>
        <button onClick={() => setShowPicker(false)} className="w-full bg-gray-600 p-2 rounded text-sm">Cancel</button>
      </div>
    );
  }
  return (
    <button onClick={() => setShowPicker(true)} className="w-full bg-red-600 p-3 rounded-lg font-semibold text-sm">
      {label}
    </button>
  );
};

// ─── FATALITY ANIMATIONS ────────────────────────────────────────────────────
// A stick figure "dies" a different random way each time someone loses a
// Death Roll. 12 of these animate the whole figure; sliced/decapitated/exploded
// animate individual limbs (see the CSS in `styles` further down).
const FATALITY_ANIMATIONS = [
  "fall-backward", "fall-forward", "spin-fly-off", "melt", "vaporize",
  "electrocuted", "crushed", "frozen-shatter", "blown-away",
  "sliced", "decapitated", "exploded", "ghost-departure", "sink", "launched",
];

const StickFigure = ({ anim }) => (
  <svg viewBox="0 0 100 140" className={`fatality-anim-${anim}`} style={{ width: 160, height: 224, color: "#ff8736" }}>
    <circle className="sf-head" cx="50" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="6" />
    <line className="sf-bodyUpper" x1="50" y1="29" x2="50" y2="80" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line className="sf-armL" x1="50" y1="42" x2="22" y2="62" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line className="sf-armR" x1="50" y1="42" x2="78" y2="62" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line className="sf-legL" x1="50" y1="80" x2="28" y2="128" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
    <line className="sf-legR" x1="50" y1="80" x2="72" y2="128" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
  </svg>
);

const StatCard = ({ label, value, sub, color = "purple" }) => {
  const colors = {
    purple: "bg-[#282a3b]", green: "bg-green-800",
    blue: "bg-blue-800", yellow: "bg-yellow-700",
    red: "bg-red-800", orange: "bg-orange-800",
  };
  return (
    <div className={`${colors[color]} p-3 rounded-lg text-center`}>
      <div className="text-2xl font-black">{value ?? "—"}</div>
      <div className="text-xs font-semibold mt-1 opacity-90">{label}</div>
      {sub && <div className="text-xs opacity-60 mt-0.5">{sub}</div>}
    </div>
  );
};

// ─── STATS VIEW ───────────────────────────────────────────────────────────────

// ─── SEASON HELPERS ───────────────────────────────────────────────────────────

const getQuarterKey = (date) => {
  const d = new Date(date);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
};

const getCurrentQuarterKey = () => getQuarterKey(new Date());

const quarterStart = (key) => {
  const [q, year] = key.split(" ");
  const month = (parseInt(q[1]) - 1) * 3;
  return new Date(parseInt(year), month, 1);
};

const quarterEnd = (key) => {
  const [q, year] = key.split(" ");
  const month = parseInt(q[1]) * 3;
  return new Date(parseInt(year), month, 1);
};

// ─── PLAYOFF HELPERS ────────────────────────────────────────────────────────

// Thanksgiving = the 4th Thursday of November. Playoff seeding counts every
// win from Jan 1 through end-of-day Thanksgiving of the given year, regardless
// of the Leaderboard tab's season filter.
const getThanksgiving = (year) => {
  const nov1 = new Date(year, 10, 1);
  const firstThursday = 1 + ((4 - nov1.getDay() + 7) % 7);
  const fourthThursday = firstThursday + 21;
  return new Date(year, 10, fourthThursday, 23, 59, 59, 999);
};

// Standard single-elimination seed order (e.g. for 8 seeds: [1,8,4,5,2,7,3,6])
// so the top 2 seeds can only meet in the final, not an arbitrary 1-v-8/2-v-7 list.
const seedOrder = (bracketSize) => {
  let order = [1, 2];
  while (order.length < bracketSize) {
    const sum = order.length * 2 + 1;
    const next = [];
    order.forEach(s => { next.push(s); next.push(sum - s); });
    order = next;
  }
  return order;
};

// ─── GAME PROGRESS CHART (per-player cumulative points for one game) ──────────

// Consistent color per player, assigned by seat order within the game. Pulled
// from the Vivint brand palette (Visionary Green, Confident Orange, Imaginative
// Pink, Visionary Green Alt, Gray 1) plus lighter in-family tints for extra
// players, so multi-line charts stay distinguishable without leaving the palette.
const PLAYER_LINE_COLORS = [
  "#05e5af", "#ff8736", "#ff66cc", "#00a073",
  "#cccccc", "#ffb27a", "#ffa3e0", "#6ff0d2",
];
const colorForPlayerIndex = (i) => PLAYER_LINE_COLORS[i % PLAYER_LINE_COLORS.length];

// Every scoring event now logs its own point_delta at the moment it happens
// (see logShot in the main app), including ones that used to be invisible to the
// shot log: Triple Tap, poison ticks, and Death Roll / resurrection score resets,
// and Abraham Clinkin' logs a row per affected player instead of just the shooter.
// So the chart just sums point_delta for new games. Games saved before this change
// won't have point_delta stored, so we fall back to the old inference for those —
// which still can't fully capture the same handful of multi-player/legacy events.
const legacyShotPointDelta = (shot) => {
  const n = shot.ball_number ?? 0;
  switch (shot.shot_type) {
    case "hit": return n;
    case "ricochet": return n * 2;
    case "scratch": return -n;
    case "scratch_pocket": return -(n + 3);
    case "gamble_win": return n;
    case "gamble_loss": return -n;
    case "parlay_add": return n;
    case "parlay_remove": return -n;
    case "abraham_clinkin_made": return n;
    case "abraham_clinkin_noScratch": return n;
    default: return 0;
  }
};
const shotPointDelta = (shot) =>
  shot.point_delta !== undefined && shot.point_delta !== null
    ? shot.point_delta
    : legacyShotPointDelta(shot);

const shotDescription = (shot) => {
  const n = shot.ball_number;
  switch (shot.shot_type) {
    case "hit": return `hit ball ${n}`;
    case "ricochet": return `ricocheted ball ${n}`;
    case "scratch": return `scratched on ball ${n}`;
    case "scratch_pocket": return `scratched + pocketed ball ${n}`;
    case "gamble_win": return `won the gamble (+${n})`;
    case "gamble_loss": return `lost the gamble (-${n})`;
    case "parlay_add": return `added ${n} parlay pts`;
    case "parlay_remove": return `removed ${n} parlay pts`;
    case "death_roll": return `death roll — ${shot.result ?? "?"}`;
    case "death_reset": return "score reset (Death Roll / resurrection)";
    case "poison_tick": return `poison tick (level ${n})`;
    case "triple_tap": return "Triple Tap (score flipped)";
    case "manual_adjustment": return `manual score adjustment (${shot.point_delta > 0 ? "+" : ""}${shot.point_delta})`;
    case "abraham_clinkin_made": return `Abraham Clinkin' — made it`;
    case "abraham_clinkin_noScratch": return `Abraham Clinkin' — no scratch`;
    case "abraham_clinkin_scratch": return `Abraham Clinkin' — scratched`;
    default: return shot.shot_type.replace(/_/g, " ");
  }
};

// Turns a flat, id-ordered shot log into cumulative-score rows suitable for a
// multi-line chart: one row per shot, one column per player.
const buildCumulativeSeries = (shots, playerNames) => {
  const sorted = [...shots].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const running = {};
  playerNames.forEach((name) => { running[name] = 0; });

  const rows = [{ shot: 0, who: "Start", detail: "", ...running }];
  sorted.forEach((s, idx) => {
    if (s.player_name in running) {
      running[s.player_name] += shotPointDelta(s);
    }
    rows.push({
      shot: idx + 1,
      who: s.player_name,
      detail: shotDescription(s),
      ...running,
    });
  });
  return rows;
};

// Custom tooltip: shows which shot happened plus every player's running total.
const GameProgressTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-[#14151d] border border-[#4b4e63] rounded-lg p-2 text-xs shadow-lg">
      <div className="font-bold mb-1">
        Shot #{label}{point.who && point.who !== "Start" ? ` — ${point.who} ${point.detail}` : ""}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
};

// Tooltip for the season-long "wins over time" chart: shows the date, who won
// that specific game, and every player's cumulative win count at that point.
const WinsTimeTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-[#14151d] border border-[#4b4e63] rounded-lg p-2 text-xs shadow-lg">
      <div className="font-bold mb-1">
        Game #{label}
        {point.date ? ` — ${new Date(point.date).toLocaleDateString()}` : ""}
        {point.winner ? ` — 🏆 ${point.winner}` : ""}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.dataKey}: {p.value}
        </div>
      ))}
    </div>
  );
};

const GameProgressChart = ({ playerNames, shots, loading, error }) => {
  const series = useMemo(
    () => buildCumulativeSeries(shots || [], playerNames),
    [shots, playerNames]
  );
  // A game is an "exact" replay only if every shot has a real point_delta
  // (i.e. it was played after this fix). Older games fall back to the legacy,
  // best-effort inference and are labeled accordingly.
  const isExact = useMemo(
    () => (shots || []).every(s => s.point_delta !== undefined && s.point_delta !== null),
    [shots]
  );

  if (loading) {
    return <div className="text-center py-8 text-[#c9c6be] animate-pulse text-sm">Loading shot-by-shot data...</div>;
  }
  if (error) {
    return <div className="text-center py-8 text-red-400 text-sm">⚠️ Could not load shots: {error}</div>;
  }
  if (!shots || shots.length === 0) {
    return <div className="text-center py-8 text-[#4fd8ac] text-sm">No shot-by-shot data recorded for this game.</div>;
  }

  return (
    <div className="bg-[#14151d] rounded-lg p-3 mt-2">
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#363849" />
            <XAxis
              dataKey="shot" stroke="#c9c6be" tick={{ fontSize: 11 }}
              label={{ value: "Shot #", position: "insideBottom", offset: -2, fill: "#c9c6be", fontSize: 11 }}
            />
            <YAxis stroke="#c9c6be" tick={{ fontSize: 11 }} />
            <Tooltip content={<GameProgressTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {playerNames.map((name, i) => (
              <Line
                key={name} type="monotone" dataKey={name}
                stroke={colorForPlayerIndex(i)} strokeWidth={2}
                dot={{ r: 2 }} activeDot={{ r: 5 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs text-[#4fd8ac] mt-1">
        {isExact
          ? "Every scoring event — including gambles, poison, Triple Tap, and Death Roll resets — was logged as it happened, so this is an exact replay of the game."
          : "This game was played before shot-by-shot point tracking was added, so a few event types (gambles, poison, Triple Tap, Death Roll resets) are approximated here."}
      </div>
    </div>
  );
};

// ─── STATS VIEW ───────────────────────────────────────────────────────────────

const StatsView = ({ onBack }) => {
  const [allGames, setAllGames] = useState([]);
  const [allResults, setAllResults] = useState([]);
  const [allShots, setAllShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("leaderboard");
  const [selectedSeason, setSelectedSeason] = useState(getCurrentQuarterKey());

  // Recent Games → per-game shot-by-shot chart
  const [expandedGameId, setExpandedGameId] = useState(null);
  const [gameShotsById, setGameShotsById] = useState({});
  const [loadingShotsFor, setLoadingShotsFor] = useState(null);
  const [shotsErrorFor, setShotsErrorFor] = useState({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [gamesRes, resultsRes, shotsRes] = await Promise.all([
          supabase.from("games").select("*", { order: "played_at.desc", limit: 500 }),
          supabase.from("game_results").select("*"),
          supabase.from("shots").select("*"),
        ]);
        if (gamesRes.error) throw new Error("Could not load games");
        setAllGames(gamesRes.data || []);
        setAllResults(resultsRes.data || []);
        setAllShots(shotsRes.data || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Build list of all seasons that have games, most recent first
  const seasons = useMemo(() => {
    const keys = new Set(allGames.map(g => getQuarterKey(g.played_at)));
    return ["All Time", ...Array.from(keys).sort((a, b) => quarterStart(b) - quarterStart(a))];
  }, [allGames]);

  // Filter games/results/shots to the selected season
  const filteredGameIds = useMemo(() => {
    if (selectedSeason === "All Time") return new Set(allGames.map(g => g.id));
    const start = quarterStart(selectedSeason);
    const end = quarterEnd(selectedSeason);
    return new Set(
      allGames
        .filter(g => { const d = new Date(g.played_at); return d >= start && d < end; })
        .map(g => g.id)
    );
  }, [allGames, selectedSeason]);

  const games = useMemo(() =>
    allGames.filter(g => filteredGameIds.has(g.id)),
    [allGames, filteredGameIds]);

  const stats = useMemo(() => {
    const filteredResults = allResults.filter(r => filteredGameIds.has(r.game_id));
    const filteredShots = allShots.filter(s => filteredGameIds.has(s.game_id));

    const playerMap = {};
    filteredResults.forEach(r => {
      if (!playerMap[r.player_name]) {
        playerMap[r.player_name] = {
          name: r.player_name,
          games: 0, wins: 0, totalScore: 0, bestScore: -Infinity,
          totalBallsPocketed: 0, totalRicochets: 0,
          totalScratches: 0, totalDeathRolls: 0, totalDeaths: 0,
          placements: [],
          gambleWins: 0, gambleLosses: 0, gambleNet: 0,
          // Parlays: total attempts, how many hit (parlay_add) vs missed (parlay_remove),
          // and a breakdown by the point value of the parlay (5 / 8 / 11, etc).
          parlayNet: 0, parlayAttempts: 0, parlayWins: 0, parlayLosses: 0,
          parlayByType: {},
          // Abraham Clinkin': tracked separately for the two roles you can play —
          // shooter (attempting the shot) and gambler (betting on someone else's shot).
          abrahamShooterCount: 0, abrahamGamblerCount: 0, abrahamNet: 0,
          abrahamShooterAttempts: 0, abrahamShooterMade: 0,
          abrahamShooterNoScratch: 0, abrahamShooterScratched: 0,
          abrahamGamblerAttempts: 0, abrahamGamblerWon: 0, abrahamGamblerLost: 0,
        };
      }
      const p = playerMap[r.player_name];
      p.games++;
      if (r.placement === 1) p.wins++;
      p.totalScore += r.final_score;
      if (r.final_score > p.bestScore) p.bestScore = r.final_score;
      p.placements.push(r.placement);
    });

    filteredShots.forEach(s => {
      if (!playerMap[s.player_name]) return;
      const p = playerMap[s.player_name];
      if (s.shot_type === "hit") p.totalBallsPocketed++;
      if (s.shot_type === "ricochet") { p.totalBallsPocketed++; p.totalRicochets++; }
      if (s.shot_type === "scratch" || s.shot_type === "scratch_pocket") p.totalScratches++;
      if (s.shot_type === "death_roll") p.totalDeathRolls++;
      if (s.shot_type === "death_roll" && s.result === "ghost") p.totalDeaths++;

      // Gambling — plain coin-flip style bets on a shot.
      if (s.shot_type === "gamble_win") { p.gambleWins++; p.gambleNet += shotPointDelta(s); }
      if (s.shot_type === "gamble_loss") { p.gambleLosses++; p.gambleNet += shotPointDelta(s); }

      // Parlays — each add/remove event is one parlay attempt at a given point
      // value (ball_number holds the parlay's point size, e.g. 5/8/11).
      if (s.shot_type === "parlay_add" || s.shot_type === "parlay_remove") {
        p.parlayNet += shotPointDelta(s);
        p.parlayAttempts++;
        const type = s.ball_number ?? "?";
        if (!p.parlayByType[type]) p.parlayByType[type] = { wins: 0, losses: 0 };
        if (s.shot_type === "parlay_add") { p.parlayWins++; p.parlayByType[type].wins++; }
        else { p.parlayLosses++; p.parlayByType[type].losses++; }
      }

      // Abraham Clinkin' — one row per affected player, tagged with the outcome.
      // Role (shooter vs gambler) is inferred from the sign of that player's own
      // point_delta on the row, since shooter and gamblers move opposite ways.
      if (s.shot_type.startsWith("abraham_clinkin_")) {
        p.abrahamNet += shotPointDelta(s);
        const delta = shotPointDelta(s);
        if (s.shot_type === "abraham_clinkin_made") {
          if (delta > 0) { p.abrahamShooterCount++; p.abrahamShooterAttempts++; p.abrahamShooterMade++; }
          else if (delta < 0) { p.abrahamGamblerCount++; p.abrahamGamblerAttempts++; p.abrahamGamblerLost++; }
        } else if (s.shot_type === "abraham_clinkin_noScratch") {
          if (delta > 0) { p.abrahamShooterCount++; p.abrahamShooterAttempts++; p.abrahamShooterNoScratch++; }
          else if (delta < 0) { p.abrahamGamblerCount++; p.abrahamGamblerAttempts++; p.abrahamGamblerLost++; }
        } else if (s.shot_type === "abraham_clinkin_scratch") {
          if (delta > 0) { p.abrahamGamblerCount++; p.abrahamGamblerAttempts++; p.abrahamGamblerWon++; }
          else { p.abrahamShooterAttempts++; p.abrahamShooterScratched++; } // shooter's own row, delta === 0
        }
      }
    });

    return Object.values(playerMap).map(p => ({
      ...p,
      winRate: p.games > 0 ? ((p.wins / p.games) * 100).toFixed(0) : 0,
      avgScore: p.games > 0 ? (p.totalScore / p.games).toFixed(0) : 0,
      avgPlacement: p.placements.length > 0
        ? (p.placements.reduce((a, b) => a + b, 0) / p.placements.length).toFixed(1)
        : null,
      netGamblingPoints: p.gambleNet + p.parlayNet + p.abrahamNet,
      gambleWinRate: (p.gambleWins + p.gambleLosses) > 0
        ? ((p.gambleWins / (p.gambleWins + p.gambleLosses)) * 100).toFixed(0)
        : null,
    })).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
  }, [allResults, allShots, filteredGameIds]);

  const gamblingStats = useMemo(
    () => [...stats].sort((a, b) => b.netGamblingPoints - a.netGamblingPoints),
    [stats]
  );

  const [expandedGamblingPlayer, setExpandedGamblingPlayer] = useState(null);

  // Chronological cumulative win-count per player, for the "story of the season"
  // line chart at the top of the Leaderboard tab.
  const winsTimeSeries = useMemo(() => {
    const sortedGames = [...games].sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
    const playerNames = stats.map(p => p.name);
    const running = {};
    playerNames.forEach(name => { running[name] = 0; });

    const rows = [{ gameNum: 0, date: null, winner: null, ...running }];
    sortedGames.forEach((g, idx) => {
      if (g.winner_name in running) running[g.winner_name] += 1;
      rows.push({
        gameNum: idx + 1,
        date: g.played_at,
        winner: g.winner_name,
        ...running,
      });
    });
    return { rows, playerNames };
  }, [games, stats]);

  const tabs = ["leaderboard", "per-player", "gambling", "playoffs", "recent games"];
  const isCurrentSeason = selectedSeason === getCurrentQuarterKey();

  // Projected playoff bracket: seeded on total wins from Jan 1 through
  // Thanksgiving of the current year, independent of the Leaderboard's season
  // filter above. Once actual playoffs start, this is the piece that'll grow
  // to track live bracket progress instead of just a projection.
  const playoffBracket = useMemo(() => {
    const year = new Date().getFullYear();
    const cutoff = getThanksgiving(year);
    const yearStart = new Date(year, 0, 1);
    const eligibleGameIds = new Set(
      allGames
        .filter(g => { const d = new Date(g.played_at); return d >= yearStart && d <= cutoff; })
        .map(g => g.id)
    );
    const winCounts = {};
    const gameCounts = {};
    allResults
      .filter(r => eligibleGameIds.has(r.game_id))
      .forEach(r => {
        gameCounts[r.player_name] = (gameCounts[r.player_name] || 0) + 1;
        if (r.placement === 1) winCounts[r.player_name] = (winCounts[r.player_name] || 0) + 1;
      });

    const seeds = Object.keys(gameCounts)
      .map(name => ({
        name,
        wins: winCounts[name] || 0,
        games: gameCounts[name],
        winRate: gameCounts[name] > 0 ? (winCounts[name] || 0) / gameCounts[name] : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games)
      .map((p, i) => ({ ...p, seed: i + 1 }));

    if (seeds.length < 2) return { seeds, matchups: [], bracketSize: 0, cutoff };

    let bracketSize = 2;
    while (bracketSize < seeds.length) bracketSize *= 2;
    const order = seedOrder(bracketSize);
    const matchups = [];
    for (let i = 0; i < order.length; i += 2) {
      const seedA = seeds.find(s => s.seed === order[i]) || null;
      const seedB = seeds.find(s => s.seed === order[i + 1]) || null;
      matchups.push({ seedA, seedB });
    }
    return { seeds, matchups, bracketSize, cutoff };
  }, [allGames, allResults]);

  // Detect a Recent Game click: toggle it open/closed, and pull that game's
  // shot-by-shot data (cached after the first fetch) to feed the progress chart.
  const toggleGameExpand = async (game) => {
    if (expandedGameId === game.id) {
      setExpandedGameId(null);
      return;
    }
    setExpandedGameId(game.id);
    if (gameShotsById[game.id]) return; // already pulled

    setLoadingShotsFor(game.id);
    setShotsErrorFor(prev => ({ ...prev, [game.id]: null }));
    try {
      const { data, error: shotsErr } = await supabase.from("shots").select("*", {
        filter: `game_id=eq.${game.id}`,
        order: "id.asc",
      });
      if (shotsErr) throw new Error(shotsErr.message || "Could not load shots");
      setGameShotsById(prev => ({ ...prev, [game.id]: data || [] }));
    } catch (e) {
      setShotsErrorFor(prev => ({ ...prev, [game.id]: e.message }));
    } finally {
      setLoadingShotsFor(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1d1f2c] to-[#0e0f16] text-white p-4">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="bg-[#363849] hover:bg-[#4b4e63] px-3 py-2 rounded-lg text-sm font-bold">← Back</button>
          <h1 className="text-2xl font-black text-[#05e5af]">📊 Stats</h1>
        </div>

        {/* Season selector */}
        {!loading && !error && (
          <div className="mb-5">
            <div className="flex items-center gap-2 flex-wrap">
              {seasons.map(s => (
                <button key={s} onClick={() => setSelectedSeason(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                    selectedSeason === s
                      ? s === "All Time" ? 'bg-blue-600 text-white' : 'bg-yellow-500 text-black'
                      : 'bg-[#282a3b] text-[#c9c6be] hover:text-white'
                  }`}>
                  {s === getCurrentQuarterKey() ? `${s} ⚡` : s}
                </button>
              ))}
            </div>
            {isCurrentSeason && (
              <div className="text-xs text-[#4fd8ac] mt-2">⚡ Current season — stats reset each quarter, all history preserved</div>
            )}
          </div>
        )}

        {loading && <div className="text-center py-16 text-[#c9c6be] animate-pulse text-xl">Loading stats...</div>}
        {error && (
          <div className="bg-red-900 border border-red-500 p-4 rounded-lg mb-4">
            <div className="font-bold mb-1">⚠️ Could not connect to database</div>
            <div className="text-sm text-red-300">{error}</div>
            <div className="text-xs text-red-400 mt-2">Check your Supabase credentials in the config at the top of the file.</div>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="relative mb-6">
              <select
                value={activeTab}
                onChange={(e) => setActiveTab(e.target.value)}
                className="w-full appearance-none bg-[#14151d] border border-[#363849] text-white font-semibold capitalize py-3 px-4 pr-10 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-[#ff8736]"
              >
                {tabs.map(t => (
                  <option key={t} value={t} className="capitalize bg-[#14151d] text-white">
                    {t}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#ff8736] text-sm">▼</div>
            </div>

            {activeTab === "leaderboard" && (
              <div className="space-y-3">
                {stats.length === 0 && <div className="text-center py-12 text-[#4fd8ac]">No games in {selectedSeason} yet.</div>}

                {stats.length > 0 && winsTimeSeries.rows.length > 1 && (
                  <div className="bg-[#14151d] rounded-lg p-3 mb-1">
                    <div className="text-sm font-bold text-[#f3efe8] mb-1">Wins Over Time</div>
                    <div style={{ width: "100%", height: 240 }}>
                      <ResponsiveContainer>
                        <LineChart data={winsTimeSeries.rows} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#363849" />
                          <XAxis
                            dataKey="gameNum" stroke="#c9c6be" tick={{ fontSize: 11 }}
                            label={{ value: "Game #", position: "insideBottom", offset: -2, fill: "#c9c6be", fontSize: 11 }}
                          />
                          <YAxis stroke="#c9c6be" tick={{ fontSize: 11 }} allowDecimals={false} />
                          <Tooltip content={<WinsTimeTooltip />} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {winsTimeSeries.playerNames.map((name, i) => (
                            <Line
                              key={name} type="monotone" dataKey={name}
                              stroke={colorForPlayerIndex(i)} strokeWidth={2}
                              dot={false} activeDot={{ r: 4 }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-xs text-[#4fd8ac] mt-1">
                      Cumulative wins after each game in {selectedSeason}, in the order they were played.
                    </div>
                  </div>
                )}

                {stats.map((p, i) => (
                  <div key={p.name} className={`p-4 rounded-xl ${i === 0 ? 'bg-yellow-700 ring-2 ring-yellow-400' : 'bg-[#282a3b]'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="text-3xl font-black w-8">{i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</div>
                      <div>
                        <div className="text-xl font-black">{p.name}</div>
                        <div className="text-xs opacity-70">{p.games} game{p.games !== 1 ? 's' : ''} played</div>
                      </div>
                      <div className="ml-auto text-right">
                        <div className="text-2xl font-black text-green-400">{p.wins} W</div>
                        <div className="text-sm opacity-70">{p.winRate}% win rate</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <StatCard label="Avg Score" value={p.avgScore} color={i === 0 ? "yellow" : "purple"} />
                      <StatCard label="Best Game" value={p.bestScore === -Infinity ? "—" : p.bestScore} color={i === 0 ? "yellow" : "purple"} />
                      <StatCard label="Balls Pocketed" value={p.totalBallsPocketed} color={i === 0 ? "yellow" : "purple"} />
                      <StatCard label="Avg Placement" value={p.avgPlacement ? `#${p.avgPlacement}` : "—"} color={i === 0 ? "yellow" : "purple"} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "per-player" && (
              <div className="space-y-4">
                {stats.length === 0 && <div className="text-center py-12 text-[#4fd8ac]">No games in {selectedSeason} yet.</div>}
                {stats.map((p) => (
                  <div key={p.name} className="bg-[#282a3b] rounded-xl p-4">
                    <div className="text-xl font-black mb-3">{p.name}</div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <StatCard label="Games" value={p.games} color="blue" />
                      <StatCard label="Wins" value={p.wins} color="green" />
                      <StatCard label="Win Rate" value={`${p.winRate}%`} color="green" />
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <StatCard label="Avg Score" value={p.avgScore} color="purple" />
                      <StatCard label="Best Score" value={p.bestScore === -Infinity ? "—" : p.bestScore} color="yellow" />
                      <StatCard label="Avg Place" value={p.avgPlacement ? `#${p.avgPlacement}` : "—"} color="purple" />
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <StatCard label="Balls In" value={p.totalBallsPocketed} color="green" />
                      <StatCard label="Ricochets" value={p.totalRicochets} color="blue" />
                      <StatCard label="Scratches" value={p.totalScratches} color="red" />
                      <StatCard label="Deaths" value={p.totalDeaths} sub={`${p.totalDeathRolls} rolls`} color="red" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "gambling" && (
              <div className="space-y-4">
                {gamblingStats.length === 0 && <div className="text-center py-12 text-[#4fd8ac]">No games in {selectedSeason} yet.</div>}
                {gamblingStats.length > 0 && (
                  <div className="bg-[#14151d] rounded-lg p-3">
                    <div style={{ width: "100%", height: Math.max(180, gamblingStats.length * 44) }}>
                      <ResponsiveContainer>
                        <BarChart
                          data={gamblingStats}
                          layout="vertical"
                          margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#363849" />
                          <XAxis type="number" stroke="#c9c6be" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="name" stroke="#c9c6be" tick={{ fontSize: 12 }} width={80} />
                          <Tooltip
                            contentStyle={{ background: "#1d1f2c", border: "1px solid #4b4e63", fontSize: 12 }}
                            labelStyle={{ color: "#f3efe8" }}
                          />
                          <Bar dataKey="netGamblingPoints" name="Net gambling pts" radius={[0, 4, 4, 0]}>
                            {gamblingStats.map((p) => (
                              <Cell key={p.name} fill={p.netGamblingPoints >= 0 ? "#05e5af" : "#f87171"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="text-xs text-[#4fd8ac] mt-1">
                      Net points from gambles, parlays, and Abraham Clinkin' combined — green means they're up overall, red means the side bets are costing them.
                    </div>
                  </div>
                )}
                {gamblingStats.map((p) => (
                  <div key={p.name} className="bg-[#282a3b] rounded-xl p-4">
                    <button
                      onClick={() => setExpandedGamblingPlayer(expandedGamblingPlayer === p.name ? null : p.name)}
                      className="w-full text-left"
                      aria-expanded={expandedGamblingPlayer === p.name}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xl font-black flex items-center gap-1">
                          <span className="text-[#4fd8ac] text-xs">{expandedGamblingPlayer === p.name ? "▾" : "▸"}</span>
                          {p.name}
                        </div>
                        <div className={`text-2xl font-black ${p.netGamblingPoints > 0 ? "text-green-400" : p.netGamblingPoints < 0 ? "text-red-400" : "text-[#c9c6be]"}`}>
                          {p.netGamblingPoints > 0 ? "+" : ""}{p.netGamblingPoints} pts
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <StatCard
                          label="Gambles"
                          value={`${p.gambleWins}-${p.gambleLosses}`}
                          sub={p.gambleWinRate !== null ? `${p.gambleWinRate}% win` : "—"}
                          color="blue"
                        />
                        <StatCard
                          label="Parlay Net"
                          value={`${p.parlayNet > 0 ? "+" : ""}${p.parlayNet}`}
                          sub={`${p.parlayAttempts} attempt${p.parlayAttempts !== 1 ? "s" : ""}`}
                          color={p.parlayNet >= 0 ? "green" : "red"}
                        />
                        <StatCard
                          label="Abraham Net"
                          value={`${p.abrahamNet > 0 ? "+" : ""}${p.abrahamNet}`}
                          sub={`${p.abrahamShooterCount} shot / ${p.abrahamGamblerCount} bet`}
                          color={p.abrahamNet >= 0 ? "green" : "red"}
                        />
                      </div>
                    </button>

                    {expandedGamblingPlayer === p.name && (
                      <div className="mt-4 pt-4 border-t border-[#363849] space-y-4">
                        {/* Parlay breakdown */}
                        <div>
                          <div className="text-sm font-bold text-[#f3efe8] mb-2">🎯 Parlay Breakdown</div>
                          <div className="grid grid-cols-3 gap-2 mb-2">
                            <StatCard label="Attempts" value={p.parlayAttempts} color="purple" />
                            <StatCard label="Hit" value={p.parlayWins} color="green" />
                            <StatCard label="Missed" value={p.parlayLosses} color="red" />
                          </div>
                          {Object.keys(p.parlayByType).length > 0 ? (
                            <div className="space-y-1">
                              {Object.entries(p.parlayByType)
                                .sort((a, b) => Number(a[0]) - Number(b[0]))
                                .map(([type, rec]) => (
                                  <div key={type} className="flex items-center justify-between bg-[#1d1f2c] rounded-lg px-3 py-2 text-sm">
                                    <span className="font-semibold">{type}-pt Parlay</span>
                                    <span>
                                      <span className="text-green-400 font-bold">{rec.wins}W</span>
                                      {" – "}
                                      <span className="text-red-400 font-bold">{rec.losses}L</span>
                                    </span>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className="text-xs text-[#4fd8ac]">No parlays attempted.</div>
                          )}
                        </div>

                        {/* Abraham Clinkin' breakdown */}
                        <div>
                          <div className="text-sm font-bold text-[#f3efe8] mb-2">😬 Abraham Clinkin' Breakdown</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-[#1d1f2c] rounded-lg p-3">
                              <div className="text-xs uppercase tracking-wide text-[#c9c6be] mb-2">As Shooter</div>
                              <div className="text-sm space-y-1">
                                <div className="flex justify-between"><span>Attempts</span><span className="font-bold">{p.abrahamShooterAttempts}</span></div>
                                <div className="flex justify-between"><span className="text-yellow-300">Made it</span><span className="font-bold text-yellow-300">{p.abrahamShooterMade}</span></div>
                                <div className="flex justify-between"><span className="text-orange-300">No-Scratch</span><span className="font-bold text-orange-300">{p.abrahamShooterNoScratch}</span></div>
                                <div className="flex justify-between"><span className="text-red-400">Scratched</span><span className="font-bold text-red-400">{p.abrahamShooterScratched}</span></div>
                              </div>
                            </div>
                            <div className="bg-[#1d1f2c] rounded-lg p-3">
                              <div className="text-xs uppercase tracking-wide text-[#c9c6be] mb-2">As Gambler</div>
                              <div className="text-sm space-y-1">
                                <div className="flex justify-between"><span>Bets</span><span className="font-bold">{p.abrahamGamblerAttempts}</span></div>
                                <div className="flex justify-between"><span className="text-green-400">Won</span><span className="font-bold text-green-400">{p.abrahamGamblerWon}</span></div>
                                <div className="flex justify-between"><span className="text-red-400">Lost</span><span className="font-bold text-red-400">{p.abrahamGamblerLost}</span></div>
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-[#4fd8ac] mt-2">
                            Made the ball on a Clinkin' {p.abrahamShooterMade} time{p.abrahamShooterMade !== 1 ? "s" : ""}.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === "playoffs" && (
              <div className="space-y-5">
                <div className="bg-[#282a3b] rounded-lg p-3 text-sm text-[#c9c6be]">
                  🏆 Projected seeding from all wins in {new Date().getFullYear()} through Thanksgiving
                  ({playoffBracket.cutoff.toLocaleDateString()}). This updates automatically as more games get played —
                  it's a projection, not a locked bracket. Once playoffs actually start, this tab will track live results instead.
                </div>

                {playoffBracket.seeds.length < 2 ? (
                  <div className="text-center py-12 text-[#4fd8ac]">Not enough games played yet this year to project a bracket.</div>
                ) : (
                  <>
                    {/* Seeding list */}
                    <div>
                      <div className="text-sm font-bold text-[#05e5af] mb-2">Seeding</div>
                      <div className="space-y-1">
                        {playoffBracket.seeds.map(s => (
                          <div key={s.name} className="flex items-center justify-between bg-[#282a3b] rounded-lg px-3 py-2">
                            <div className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full bg-[#4b4e63] flex items-center justify-center text-xs font-black">{s.seed}</div>
                              <div className="font-semibold">{s.name}</div>
                            </div>
                            <div className="text-sm text-[#c9c6be]">{s.wins}W · {s.games}G</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Bracket shell: Round 1 is filled from seeding; later rounds are TBD
                        until actual playoff results start feeding this tab. */}
                    <div>
                      <div className="text-sm font-bold text-[#05e5af] mb-2">Projected Bracket</div>
                      <div className="flex gap-4 overflow-x-auto pb-2">
                        <div className="flex flex-col gap-3 min-w-[220px]">
                          <div className="text-xs uppercase tracking-wide text-[#c9c6be] text-center">Round 1</div>
                          {playoffBracket.matchups.map((m, i) => (
                            <div key={i} className="bg-[#282a3b] rounded-lg p-2 space-y-1">
                              <div className={`flex items-center justify-between px-2 py-1.5 rounded ${m.seedA ? 'bg-[#1d1f2c]' : 'bg-transparent opacity-50'}`}>
                                <span className="text-sm font-semibold">{m.seedA ? `#${m.seedA.seed} ${m.seedA.name}` : "—"}</span>
                              </div>
                              <div className="text-center text-[10px] text-[#63667d]">vs</div>
                              <div className={`flex items-center justify-between px-2 py-1.5 rounded ${m.seedB ? 'bg-[#1d1f2c]' : 'bg-[#ff8736] bg-opacity-10'}`}>
                                <span className="text-sm font-semibold">{m.seedB ? `#${m.seedB.seed} ${m.seedB.name}` : "BYE"}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {Array.from({ length: Math.log2(playoffBracket.bracketSize) - 1 }).map((_, roundIdx) => {
                          const matchCount = playoffBracket.matchups.length / Math.pow(2, roundIdx + 1);
                          const roundLabel = matchCount === 1 ? "Final" : matchCount === 2 ? "Semifinals" : `Round ${roundIdx + 2}`;
                          return (
                            <div key={roundIdx} className="flex flex-col justify-around gap-3 min-w-[180px]">
                              <div className="text-xs uppercase tracking-wide text-[#c9c6be] text-center">{roundLabel}</div>
                              {Array.from({ length: matchCount }).map((_, mIdx) => (
                                <div key={mIdx} className="bg-[#282a3b] rounded-lg p-2 space-y-1 opacity-50">
                                  <div className="px-2 py-1.5 rounded bg-[#1d1f2c] text-sm font-semibold">TBD</div>
                                  <div className="text-center text-[10px] text-[#63667d]">vs</div>
                                  <div className="px-2 py-1.5 rounded bg-[#1d1f2c] text-sm font-semibold">TBD</div>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "recent games" && (
              <div className="space-y-3">
                {games.length === 0 && <div className="text-center py-12 text-[#4fd8ac]">No games in {selectedSeason} yet.</div>}
                {games.map((g) => (
                  <div key={g.id} className="bg-[#282a3b] rounded-xl p-4">
                    <button
                      onClick={() => toggleGameExpand(g)}
                      className="w-full text-left"
                      aria-expanded={expandedGameId === g.id}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="font-bold flex items-center gap-1">
                            <span className="text-[#4fd8ac] text-xs">{expandedGameId === g.id ? "▾" : "▸"}</span>
                            {g.player_names?.join(", ")}
                          </div>
                          <div className="text-xs text-[#c9c6be]">{g.player_count} players · Ball {g.final_ball ?? "?"} reached</div>
                        </div>
                        <div className="text-right text-xs text-[#4fd8ac]">
                          {g.played_at ? new Date(g.played_at).toLocaleDateString() : ""}
                          {g.ended_early && <div className="text-orange-400 font-semibold">⏱️ Early end</div>}
                        </div>
                      </div>
                      <div className="text-sm">
                        <span className="text-yellow-400 font-bold">🏆 {g.winner_name}</span>
                        <span className="text-gray-400 ml-2">— {g.winner_score} pts</span>
                      </div>
                    </button>

                    {expandedGameId === g.id && (
                      <GameProgressChart
                        playerNames={g.player_names || []}
                        shots={gameShotsById[g.id]}
                        loading={loadingShotsFor === g.id}
                        error={shotsErrorFor[g.id]}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap');

  /* Vivint brand type: the real Vivint brand font isn't a licensed web font, so
     Poppins is used as the closest available geometric-sans approximation. */
  body, #root { font-family: 'Poppins', system-ui, sans-serif; }

  @keyframes flipCoin {
    0%   { transform: rotateY(0deg) scale(1); }
    50%  { transform: rotateY(900deg) scale(1.3); }
    100% { transform: rotateY(1800deg) scale(1); }
  }
  .coin-flip-anim { animation: flipCoin 1.8s ease-out forwards; display: inline-block; }

  @keyframes rollDice {
    0%   { transform: rotate(0deg) scale(1); }
    20%  { transform: rotate(72deg) scale(1.2); }
    40%  { transform: rotate(144deg) scale(0.9); }
    60%  { transform: rotate(216deg) scale(1.3); }
    80%  { transform: rotate(288deg) scale(0.95); }
    100% { transform: rotate(360deg) scale(1); }
  }
  .dice-roll-anim { animation: rollDice 0.3s linear infinite; display: inline-block; }

  /* ── FATALITY sequence ──────────────────────────────────────────────── */

  @keyframes fatalityShake {
    0%, 100% { transform: translate(0, 0); }
    10%, 30%, 50%, 70%, 90% { transform: translate(-6px, 0); }
    20%, 40%, 60%, 80% { transform: translate(6px, 0); }
  }
  .fatality-shake { animation: fatalityShake 0.5s linear; }

  @keyframes fatalityZoom {
    0%   { transform: scale(6) rotate(-8deg); opacity: 0; }
    60%  { transform: scale(0.9) rotate(2deg); opacity: 1; }
    80%  { transform: scale(1.08) rotate(-1deg); }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }
  .fatality-text { animation: fatalityZoom 0.7s cubic-bezier(.2,1.4,.6,1) both; animation-delay: 1.3s; opacity: 0; }

  /* Whole-figure animations */
  @keyframes sfFallBack {
    0%   { transform: rotate(0deg) translateY(0); opacity: 1; }
    60%  { transform: rotate(-80deg) translateY(10px); }
    100% { transform: rotate(-92deg) translateY(20px); opacity: 0.9; }
  }
  .fatality-anim-fall-backward { animation: sfFallBack 1.3s cubic-bezier(.36,.07,.19,.97) forwards; transform-origin: 50% 62%; }

  @keyframes sfFallFwd {
    0%   { transform: rotate(0deg); }
    60%  { transform: rotate(80deg) translateY(6px); }
    100% { transform: rotate(95deg) translateY(16px); opacity: 0.9; }
  }
  .fatality-anim-fall-forward { animation: sfFallFwd 1.3s ease-in forwards; transform-origin: 50% 62%; }

  @keyframes sfSpinFly {
    0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
    100% { transform: translate(220px, -60px) rotate(900deg); opacity: 0; }
  }
  .fatality-anim-spin-fly-off { animation: sfSpinFly 1.4s ease-in forwards; }

  @keyframes sfMelt {
    0%   { transform: scaleY(1) scaleX(1); filter: none; }
    60%  { transform: scaleY(0.5) scaleX(1.15); filter: blur(1px) hue-rotate(60deg); }
    100% { transform: scaleY(0.05) scaleX(1.4) translateY(40px); opacity: 0.7; filter: blur(2px) hue-rotate(90deg); }
  }
  .fatality-anim-melt { animation: sfMelt 1.6s ease-in forwards; transform-origin: 50% 100%; }

  @keyframes sfVaporize {
    0%   { transform: scale(1); opacity: 1; filter: brightness(1); }
    40%  { transform: scale(1.15); filter: brightness(2); }
    100% { transform: scale(1.6); opacity: 0; filter: brightness(3) blur(6px); }
  }
  .fatality-anim-vaporize { animation: sfVaporize 1.2s ease-out forwards; }

  @keyframes sfShock {
    0%, 100% { transform: translate(0, 0) rotate(0); }
    10% { transform: translate(-4px, 2px) rotate(-3deg); }
    20% { transform: translate(4px, -2px) rotate(3deg); }
    30% { transform: translate(-3px, 1px) rotate(-2deg); }
    40% { transform: translate(3px, -1px) rotate(2deg); }
    50% { transform: translate(-2px, 2px) rotate(-4deg); }
    60% { transform: translate(2px, -2px) rotate(4deg); }
    70% { opacity: 0.4; }
    80% { opacity: 1; }
    100% { transform: translateY(30px) rotate(8deg); opacity: 0.8; }
  }
  .fatality-anim-electrocuted { animation: sfShock 1.3s linear forwards; filter: drop-shadow(0 0 6px #ffe066); }

  @keyframes sfCrush {
    0%   { transform: scaleY(1); }
    70%  { transform: scaleY(0.15) translateY(45px); }
    100% { transform: scaleY(0.05) translateY(50px); }
  }
  .fatality-anim-crushed { animation: sfCrush 0.9s cubic-bezier(.6,0,1,1) forwards; transform-origin: 50% 100%; }

  @keyframes sfFreeze {
    0%   { filter: none; }
    50%  { filter: brightness(1.4) saturate(0) hue-rotate(180deg); }
    100% { filter: brightness(1.6) saturate(0) hue-rotate(180deg); opacity: 0; transform: scale(1.05); }
  }
  .fatality-anim-frozen-shatter { animation: sfFreeze 1.5s ease-in forwards; }

  @keyframes sfBlown {
    0%   { transform: translateX(0) skewX(0) rotate(0); opacity: 1; }
    100% { transform: translateX(260px) skewX(-20deg) rotate(45deg); opacity: 0; }
  }
  .fatality-anim-blown-away { animation: sfBlown 1.3s ease-in forwards; }

  @keyframes sfGhost {
    0%   { transform: translateY(0); opacity: 1; filter: none; }
    50%  { transform: translateY(-20px); opacity: 0.6; filter: grayscale(1) brightness(1.3); }
    100% { transform: translateY(-140px); opacity: 0; filter: grayscale(1) brightness(1.5); }
  }
  .fatality-anim-ghost-departure { animation: sfGhost 1.8s ease-out forwards; }

  @keyframes sfSink {
    0%   { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(70px); opacity: 0; }
  }
  .fatality-anim-sink { animation: sfSink 1.4s ease-in forwards; }

  @keyframes sfLaunch {
    0%   { transform: translateY(0) scale(1) rotate(0); opacity: 1; }
    30%  { transform: translateY(-20px) scale(1.05) rotate(30deg); }
    100% { transform: translateY(-320px) scale(0.3) rotate(540deg); opacity: 0; }
  }
  .fatality-anim-launched { animation: sfLaunch 1.1s cubic-bezier(.5,0,.9,.4) forwards; }

  /* Per-limb animations */
  @keyframes sliceTopHalf {
    0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
    100% { transform: translate(-30px, -15px) rotate(-15deg); opacity: 0.85; }
  }
  @keyframes sliceBottomHalf {
    0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
    100% { transform: translate(30px, 25px) rotate(15deg); opacity: 0.85; }
  }
  .fatality-anim-sliced .sf-head,
  .fatality-anim-sliced .sf-armL,
  .fatality-anim-sliced .sf-armR,
  .fatality-anim-sliced .sf-bodyUpper {
    animation: sliceTopHalf 1s ease-out forwards; transform-box: fill-box; transform-origin: center;
  }
  .fatality-anim-sliced .sf-legL,
  .fatality-anim-sliced .sf-legR {
    animation: sliceBottomHalf 1s ease-out forwards; transform-box: fill-box; transform-origin: center;
  }

  @keyframes decapHead {
    0%   { transform: translate(0, 0) rotate(0); opacity: 1; }
    100% { transform: translate(40px, -90px) rotate(360deg); opacity: 0; }
  }
  @keyframes decapBody {
    0%   { transform: translateY(0) rotate(0); opacity: 1; }
    100% { transform: translateY(20px) rotate(8deg); opacity: 0.9; }
  }
  .fatality-anim-decapitated .sf-head {
    animation: decapHead 1.1s ease-in forwards; transform-box: fill-box; transform-origin: center;
  }
  .fatality-anim-decapitated .sf-bodyUpper,
  .fatality-anim-decapitated .sf-armL,
  .fatality-anim-decapitated .sf-armR,
  .fatality-anim-decapitated .sf-legL,
  .fatality-anim-decapitated .sf-legR {
    animation: decapBody 1.1s ease-in forwards; transform-box: fill-box; transform-origin: center;
  }

  @keyframes explHead { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(0,-90px) rotate(180deg); opacity: 0; } }
  @keyframes explArmL { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(-90px,-30px) rotate(-200deg); opacity: 0; } }
  @keyframes explArmR { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(90px,-30px) rotate(200deg); opacity: 0; } }
  @keyframes explBody { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(0,20px) scale(0.6); opacity: 0; } }
  @keyframes explLegL { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(-60px,80px) rotate(-160deg); opacity: 0; } }
  @keyframes explLegR { 0% { transform: translate(0,0) rotate(0); opacity: 1; } 100% { transform: translate(60px,80px) rotate(160deg); opacity: 0; } }
  .fatality-anim-exploded .sf-head { animation: explHead 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .fatality-anim-exploded .sf-armL { animation: explArmL 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .fatality-anim-exploded .sf-armR { animation: explArmR 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .fatality-anim-exploded .sf-bodyUpper { animation: explBody 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .fatality-anim-exploded .sf-legL { animation: explLegL 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }
  .fatality-anim-exploded .sf-legR { animation: explLegR 0.9s ease-out forwards; transform-box: fill-box; transform-origin: center; }

  /* ── Storylines: live in-game momentum on a player's card ──────────────── */

  @keyframes flameGlow {
    0%, 100% { box-shadow: 0 0 10px 2px rgba(255,135,54,0.6); }
    50%      { box-shadow: 0 0 22px 6px rgba(255,87,34,0.9), 0 0 10px 2px rgba(255,200,0,0.6); }
  }
  .storyline-hot-1 { animation: flameGlow 1.4s ease-in-out infinite; border: 2px solid #ff8736; }
  .storyline-hot-2 { animation: flameGlow 0.8s ease-in-out infinite; border: 2px solid #ff3300; }

  @keyframes coldPulse {
    0%, 100% { box-shadow: 0 0 8px 1px rgba(100,120,160,0.5); }
    50%      { box-shadow: 0 0 16px 3px rgba(80,100,150,0.75); }
  }
  @keyframes crumbleShake {
    0%, 100% { transform: translate(0, 0) rotate(0); }
    20% { transform: translate(-1px, 0) rotate(-0.4deg); }
    40% { transform: translate(1px, 0) rotate(0.4deg); }
    60% { transform: translate(-1px, 0) rotate(-0.3deg); }
    80% { transform: translate(1px, 0) rotate(0.3deg); }
  }
  .storyline-cold-1 { animation: coldPulse 1.8s ease-in-out infinite; border: 2px solid #63667d; filter: saturate(0.85); }
  .storyline-cold-2 { animation: coldPulse 1s ease-in-out infinite, crumbleShake 0.6s ease-in-out infinite; border: 2px solid #3a3f52; filter: saturate(0.6) brightness(0.9); }
`;

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

export default function NewGamePlusScorekeeper() {
  const [numPlayers, setNumPlayers] = useState(null);
  const [players, setPlayers] = useState([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [targetBall, setTargetBall] = useState(1);
  const [history, setHistory] = useState([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [gamblingPlayers, setGamblingPlayers] = useState([]);
  const [showDiceRoll, setShowDiceRoll] = useState(false);
  const [diceResult, setDiceResult] = useState(null);
  const [diceRolling, setDiceRolling] = useState(false);
  const [rollingPlayer, setRollingPlayer] = useState(null);
  const [showFatality, setShowFatality] = useState(false);
  const [fatalityAnim, setFatalityAnim] = useState(null);
  const fatalityTimeoutRef = useRef(null);
  const [editingScore, setEditingScore] = useState(null);
  const [showCoinFlip, setShowCoinFlip] = useState(false);
  const [coinResult, setCoinResult] = useState(null);
  const [coinFlipping, setCoinFlipping] = useState(false);
  const [gameEndedEarly, setGameEndedEarly] = useState(false);
  const [showEndGameConfirm, setShowEndGameConfirm] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [gameId, setGameId] = useState(null);
  const [savingGame, setSavingGame] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [gameSaved, setGameSaved] = useState(false);
  const [shotLog, setShotLog] = useState([]);
  const [showManagePlayers, setShowManagePlayers] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const availablePlayers = [
    'Ryan', 'Joe', 'Gabby', 'Chase', 'Carlos', 'Spencer',
    'Shad', 'Rai', 'James', 'Mike', 'Heber', 'Zach'
  ];

  // point_delta is the *actual* score change caused by this event — the source of
  // truth for the progress chart, instead of re-deriving it from shot_type later.
  const logShot = useCallback((playerName, shotType, ballNumber = null, result = null, pointDelta = 0) => {
    setShotLog(prev => [...prev, { player_name: playerName, shot_type: shotType, ball_number: ballNumber, result, point_delta: pointDelta }]);
  }, []);

  const togglePlayerSelection = (playerName) => {
    if (selectedPlayers.includes(playerName)) {
      setSelectedPlayers(selectedPlayers.filter(p => p !== playerName));
    } else {
      if (!selectedPlayers.includes(playerName)) setSelectedPlayers([...selectedPlayers, playerName]);
    }
  };

  const startGame = () => {
    if (selectedPlayers.length < 2) { alert('Please select at least 2 players'); return; }
    const shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    const newPlayers = shuffled.map((name, i) => ({
      id: i, name, score: 0, isPoisoned: false, poisonLevel: 0, isDead: false
    }));
    setPlayers(newPlayers);
    setNumPlayers(shuffled.length);
    setGameStarted(true);
    setCurrentPlayerIndex(0);
    setTargetBall(1);
    setHistory([]);
    setShotLog([]);
    setGameId(null);
    setGameSaved(false);
    setSaveError(null);
    setGameEndedEarly(false);
  };

  const triggerDeathRoll = (playerIndex) => {
    setRollingPlayer(playerIndex);
    setShowDiceRoll(true);
    setDiceResult(null);
    setDiceRolling(false);
  };

  const rollDice = () => {
    const result = Math.random() < (1 / 6) ? 'ghost' : 'smile';
    setDiceRolling(true);
    setTimeout(() => {
      setDiceRolling(false);
      setDiceResult(result);
      logShot(players[rollingPlayer]?.name, 'death_roll', targetBall, result);
      setTimeout(() => {
        setShowDiceRoll(false);
        setDiceResult(null);
        if (result === 'ghost') {
          // Hand off to the Fatality sequence instead of killing immediately —
          // rollingPlayer stays set until finishFatality() actually applies it.
          const anim = FATALITY_ANIMATIONS[Math.floor(Math.random() * FATALITY_ANIMATIONS.length)];
          setFatalityAnim(anim);
          setShowFatality(true);
          fatalityTimeoutRef.current = setTimeout(finishFatality, 3400);
        } else {
          setRollingPlayer(null);
        }
      }, 2200);
    }, 1800);
  };

  const finishFatality = () => {
    if (fatalityTimeoutRef.current) {
      clearTimeout(fatalityTimeoutRef.current);
      fatalityTimeoutRef.current = null;
    }
    setShowFatality(prev => {
      if (prev && rollingPlayer !== null) killPlayer(rollingPlayer);
      return false;
    });
    setFatalityAnim(null);
    setRollingPlayer(null);
  };

  const killPlayer = (playerIndex) => {
    const newPlayers = [...players];
    const oldScore = newPlayers[playerIndex].score;
    const otherScores = newPlayers.filter((p, idx) => idx !== playerIndex && !p.isDead).map(p => p.score);
    if (otherScores.length === 0) {
      newPlayers[playerIndex].isDead = true;
    } else {
      const nextLowest = Math.min(...otherScores);
      if (newPlayers[playerIndex].score <= nextLowest) {
        newPlayers[playerIndex].isDead = true;
      } else {
        newPlayers[playerIndex].score = nextLowest - 10;
        newPlayers[playerIndex].isDead = true;
      }
    }
    const delta = newPlayers[playerIndex].score - oldScore;
    if (delta !== 0) {
      logShot(newPlayers[playerIndex].name, 'death_reset', null, null, delta);
    }
    setPlayers(newPlayers);
  };

  const manualKillPlayer = (index) => {
    if (!window.confirm(`Kill ${players[index].name}? This applies the same score penalty as a Death Roll.`)) return;
    setHistory(h => [...h, saveState()]);
    killPlayer(index);
  };

  const revivePlayer = (index) => {
    const newPlayers = [...players];
    newPlayers[index].isDead = false;
    setPlayers(newPlayers);
  };

  const checkForResurrection = (currentPlayers) => {
    const newPlayers = [...currentPlayers];
    let changed = false;
    newPlayers.forEach((player, idx) => {
      if (player.isDead) {
        const alivePlayersBelow = newPlayers.filter((p, i) => i !== idx && !p.isDead && p.score < player.score);
        if (alivePlayersBelow.length > 0) {
          const lowestAlive = alivePlayersBelow.reduce((min, p) => p.score < min.score ? p : min);
          const lowestAliveIndex = newPlayers.findIndex(p => p === lowestAlive);
          const oldScore = newPlayers[lowestAliveIndex].score;
          player.isDead = false;
          newPlayers[lowestAliveIndex].isDead = true;
          newPlayers[lowestAliveIndex].score = player.score - 10;
          const delta = newPlayers[lowestAliveIndex].score - oldScore;
          if (delta !== 0) {
            logShot(newPlayers[lowestAliveIndex].name, 'death_reset', null, null, delta);
          }
          changed = true;
        }
      }
    });
    return changed ? newPlayers : currentPlayers;
  };

  const saveState = () => ({
    players: JSON.parse(JSON.stringify(players)),
    currentPlayerIndex,
    targetBall
  });

  const updatePlayerName = (index, name) => {
    const newPlayers = [...players];
    newPlayers[index].name = name;
    setPlayers(newPlayers);
  };

  const updatePlayerScore = (index, newScore) => {
    const newPlayers = [...players];
    const oldScore = newPlayers[index].score;
    newPlayers[index].score = newScore;
    const delta = newScore - oldScore;
    if (delta !== 0) {
      logShot(newPlayers[index].name, 'manual_adjustment', null, null, delta);
    }
    setPlayers(checkForResurrection(newPlayers));
    setEditingScore(null);
  };

  const togglePoison = (index) => {
    const newPlayers = [...players];
    const newLevel = ((newPlayers[index].poisonLevel || 0) + 1) % 3;
    newPlayers[index].poisonLevel = newLevel;
    newPlayers[index].isPoisoned = newLevel > 0;
    setPlayers(newPlayers);
  };

  const toggleGamble = (index) => {
    if (gamblingPlayers.includes(index)) {
      setGamblingPlayers(gamblingPlayers.filter(p => p !== index));
    } else {
      const next = [...gamblingPlayers, index];
      setGamblingPlayers(next);
      if (next.length === numPlayers - 1 && next.every(idx => idx !== currentPlayerIndex)) playSirenSound();
    }
  };

  const playSirenSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(400, ctx.currentTime + 0.3);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.6);
      osc.frequency.setValueAtTime(400, ctx.currentTime + 0.9);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 1.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 1.5);
    } catch (e) {}
  };

  const hitTargetBall = () => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'hit', targetBall, null, targetBall);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += targetBall;
    setPlayers(checkForResurrection(newPlayers));
    setTargetBall(t => t === 15 ? 16 : t + 1);
  };

  const ricochetShot = () => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'ricochet', targetBall, null, targetBall * 2);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += targetBall * 2;
    setPlayers(checkForResurrection(newPlayers));
    setTargetBall(t => t === 15 ? 16 : t + 1);
  };

  const scratchOnBall = (ballNumber) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'scratch', ballNumber, null, -ballNumber);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score -= ballNumber;
    setPlayers(checkForResurrection(newPlayers));
    if (ballNumber === 8 || ballNumber === 15) triggerDeathRoll(currentPlayerIndex);
  };

  const scratchBallAndPocket = (ballNumber) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'scratch_pocket', ballNumber, null, -(ballNumber + 3));
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score -= (ballNumber + 3);
    setPlayers(checkForResurrection(newPlayers));
    if (ballNumber === 8 || ballNumber === 15) triggerDeathRoll(currentPlayerIndex);
  };

  const resolveGamble = (won) => {
    if (gamblingPlayers.length === 0) return;
    setHistory(h => [...h, saveState()]);
    const newPlayers = [...players];
    gamblingPlayers.forEach(i => {
      logShot(players[i].name, won ? 'gamble_win' : 'gamble_loss', targetBall, null, won ? targetBall : -targetBall);
      newPlayers[i].score += won ? targetBall : -targetBall;
    });
    setPlayers(checkForResurrection(newPlayers));
    setGamblingPlayers([]);
  };

  const resolveAbrahamClinkin = (outcome) => {
    setHistory(h => [...h, saveState()]);
    const newPlayers = [...players];
    if (outcome === 'made') {
      gamblingPlayers.forEach(i => {
        logShot(players[i].name, 'abraham_clinkin_made', targetBall, null, -targetBall);
        newPlayers[i].score -= targetBall;
      });
      const shooterGain = targetBall * gamblingPlayers.length;
      logShot(players[currentPlayerIndex].name, 'abraham_clinkin_made', targetBall, null, shooterGain);
      newPlayers[currentPlayerIndex].score += shooterGain;
    } else if (outcome === 'noScratch') {
      gamblingPlayers.forEach(i => {
        logShot(players[i].name, 'abraham_clinkin_noScratch', targetBall, null, -targetBall);
        newPlayers[i].score -= targetBall;
      });
      logShot(players[currentPlayerIndex].name, 'abraham_clinkin_noScratch', targetBall, null, targetBall);
      newPlayers[currentPlayerIndex].score += targetBall;
    } else {
      gamblingPlayers.forEach(i => {
        logShot(players[i].name, 'abraham_clinkin_scratch', targetBall, null, targetBall);
        newPlayers[i].score += targetBall;
      });
      logShot(players[currentPlayerIndex].name, 'abraham_clinkin_scratch', targetBall, null, 0);
    }
    setPlayers(checkForResurrection(newPlayers));
    setGamblingPlayers([]);
  };

  const addParlayPoints = (pts) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'parlay_add', pts, null, pts);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += pts;
    setPlayers(newPlayers);
  };

  const removeParlayPoints = (pts) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'parlay_remove', pts, null, -pts);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score -= pts;
    setPlayers(newPlayers);
  };

  // Applies a player's end-of-turn poison damage (if any) directly to a mutable
  // players array, logging it so it shows up in the game's shot log / progress
  // chart. Shared by Single Tap and Double Tap so poison behaves consistently
  // regardless of whose turn is actually being skipped.
  const applyPoisonTick = (playersArray, index) => {
    const poisonLevel = playersArray[index].poisonLevel || 0;
    if (poisonLevel > 0) {
      const poisonDelta = -(poisonLevel * 5);
      playersArray[index].score += poisonDelta;
      logShot(playersArray[index].name, 'poison_tick', poisonLevel, null, poisonDelta);
    }
    return playersArray;
  };

  const doSingleTap = (snapshot) => {
    const newPlayers = applyPoisonTick([...snapshot], currentPlayerIndex);
    const checked = checkForResurrection(newPlayers);
    setPlayers(checked);
    let next = (currentPlayerIndex + 1) % numPlayers;
    let safety = 0;
    while (checked[next]?.isDead && next !== currentPlayerIndex && safety < numPlayers) {
      next = (next + 1) % numPlayers; safety++;
    }
    setCurrentPlayerIndex(next);
  };

  const doDoubleTap = () => {
    // The skipped player's turn never happens, but poison still ticks for them —
    // otherwise being poisoned and skipped was a free pass from the damage.
    const skippedIndex = (currentPlayerIndex + 1) % numPlayers;
    const newPlayers = applyPoisonTick([...players], skippedIndex);
    const checked = checkForResurrection(newPlayers);
    setPlayers(checked);
    let next = (currentPlayerIndex + 2) % numPlayers;
    let safety = 0;
    while (checked[next]?.isDead && next !== currentPlayerIndex && safety < numPlayers) {
      next = (next + 1) % numPlayers; safety++;
    }
    setCurrentPlayerIndex(next);
  };

  const endTurn = () => {
    setHistory(h => [...h, saveState()]);
    doSingleTap([...players]);
  };

  const doubleTap = () => {
    setHistory(h => [...h, saveState()]);
    doDoubleTap();
  };

  const tripleTap = () => {
    setHistory(h => [...h, saveState()]);
    const newPlayers = [...players];
    const oldScore = newPlayers[currentPlayerIndex].score;
    newPlayers[currentPlayerIndex].score *= -1;
    const delta = newPlayers[currentPlayerIndex].score - oldScore;
    if (delta !== 0) {
      logShot(newPlayers[currentPlayerIndex].name, 'triple_tap', null, null, delta);
    }
    setPlayers(checkForResurrection(newPlayers));
  };

  const schrodingerDoubleTap = () => {
    setShowCoinFlip(true);
    setCoinResult(null);
    setCoinFlipping(false);
  };

  const flipCoin = () => {
    const result = Math.random() < 0.5 ? 'single' : 'double';
    setCoinFlipping(true);
    const snapshot = JSON.parse(JSON.stringify(players));
    const snapIndex = currentPlayerIndex;
    setTimeout(() => {
      setCoinResult(result);
      setCoinFlipping(false);
      setTimeout(() => {
        setShowCoinFlip(false);
        setCoinResult(null);
        setHistory(h => [...h, { players: snapshot, currentPlayerIndex: snapIndex, targetBall }]);
        if (result === 'single') {
          doSingleTap(snapshot);
        } else {
          doDoubleTap();
        }
      }, 2200);
    }, 1800);
  };

  const undo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setPlayers(last.players);
    setCurrentPlayerIndex(last.currentPlayerIndex);
    setTargetBall(last.targetBall);
    setHistory(history.slice(0, -1));
  };

  const resetGame = () => {
    setGameStarted(false); setNumPlayers(null); setPlayers([]);
    setCurrentPlayerIndex(0); setTargetBall(1); setHistory([]);
    setSelectedPlayers([]); setGamblingPlayers([]);
    setGameEndedEarly(false); setShowEndGameConfirm(false);
    setShotLog([]); setGameId(null); setGameSaved(false); setSaveError(null);
  };

  const addPlayer = (name) => {
    const lowestScore = players.length > 0 ? Math.min(...players.map(p => p.score)) : 0;
    const newPlayer = { id: Date.now(), name, score: lowestScore, isPoisoned: false, poisonLevel: 0, isDead: false };
    const newPlayers = [...players, newPlayer];
    setPlayers(newPlayers);
    setNumPlayers(newPlayers.length);
  };

  const removePlayer = (index) => {
    const newPlayers = players.filter((_, i) => i !== index);
    setPlayers(newPlayers);
    setNumPlayers(newPlayers.length);
    setGamblingPlayers(prev => prev.filter(i => i !== index).map(i => i > index ? i - 1 : i));
    if (currentPlayerIndex >= newPlayers.length) setCurrentPlayerIndex(0);
    else if (currentPlayerIndex === index) setCurrentPlayerIndex(index % newPlayers.length || 0);
    setConfirmRemove(null);
    if (newPlayers.length < 2) setShowManagePlayers(false);
  };

  const saveGameToSupabase = useCallback(async (finalPlayers, endedEarly, finalTargetBall, currentShotLog) => {
    setSavingGame(true);
    setSaveError(null);
    try {
      const sorted = [...finalPlayers].sort((a, b) => b.score - a.score);
      const winnerPlayer = sorted[0];

      const { data: gameData, error: gameError } = await supabase.from("games").insert([{
        player_count: finalPlayers.length,
        player_names: finalPlayers.map(p => p.name),
        winner_name: winnerPlayer.name,
        winner_score: winnerPlayer.score,
        final_ball: finalTargetBall,
        ended_early: endedEarly,
        played_at: new Date().toISOString(),
      }]);
      if (gameError) throw new Error(gameError.message || "Failed to save game");

      const newGameId = gameData?.[0]?.id;
      setGameId(newGameId);

      const resultRows = sorted.map((p, i) => ({
        game_id: newGameId,
        player_name: p.name,
        final_score: p.score,
        placement: i + 1,
        was_dead: p.isDead,
      }));
      await supabase.from("game_results").insert(resultRows);

      if (currentShotLog.length > 0) {
        const shotRows = currentShotLog.map(s => ({ ...s, game_id: newGameId }));
        await supabase.from("shots").insert(shotRows);
      }

      setGameSaved(true);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSavingGame(false);
    }
  }, []);

  const currentPlayer = players[currentPlayerIndex];
  const winner = (targetBall > 15 || gameEndedEarly) && players.length > 0
    ? players.reduce((max, p) => p.score > max.score ? p : max, players[0])
    : null;
  const isAbrahamClinkin = !winner && players.length > 0 &&
    gamblingPlayers.length === numPlayers - 1 &&
    gamblingPlayers.every(idx => idx !== currentPlayerIndex);

  // ── Storylines ───────────────────────────────────────────────────────────
  // Live, in-game momentum per player, derived from this game's own shotLog —
  // NBA Jam style: string together positive point_deltas and you catch fire;
  // string together negative ones and the wheels come off. Resets whenever a
  // neutral-delta event (a Death Roll survival, a scratch outcome someone else
  // bet on, etc.) breaks the run.
  const playerStorylines = useMemo(() => {
    const storylines = {};
    players.forEach(player => {
      const myShots = shotLog.filter(s => s.player_name === player.name);
      let hotStreak = 0;
      let coldStreak = 0;
      for (let i = myShots.length - 1; i >= 0; i--) {
        const delta = myShots[i].point_delta ?? 0;
        if (delta > 0) {
          if (coldStreak > 0) break;
          hotStreak++;
        } else if (delta < 0) {
          if (hotStreak > 0) break;
          coldStreak++;
        } else {
          break; // neutral event ends whichever streak was building
        }
      }
      let status = null;
      if (hotStreak >= 5) status = { kind: 'hot', tier: 2, label: '🔥🔥 ON FIRE!', streak: hotStreak };
      else if (hotStreak >= 3) status = { kind: 'hot', tier: 1, label: '🔥 Heating Up!', streak: hotStreak };
      else if (coldStreak >= 5) status = { kind: 'cold', tier: 2, label: '🧊 Falling Apart!', streak: coldStreak };
      else if (coldStreak >= 3) status = { kind: 'cold', tier: 1, label: '📉 Cold Streak', streak: coldStreak };
      storylines[player.name] = status;
    });
    return storylines;
  }, [shotLog, players]);

  // Auto-save when winner is determined
  useEffect(() => {
    if (winner && !gameSaved && !savingGame && players.length > 0) {
      saveGameToSupabase(players, gameEndedEarly, targetBall, shotLog);
    }
  }, [winner]);

  // ── Stats view ────────────────────────────────────────────────────────────
  if (showStats) return <StatsView onBack={() => setShowStats(false)} />;

  // ── Player selection screen ───────────────────────────────────────────────
  if (!gameStarted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1d1f2c] to-[#0e0f16] text-white p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-[#282a3b] p-8 rounded-lg">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-[#05e5af]">New Game +</h1>
            <button onClick={() => setShowStats(true)} className="bg-[#4b4e63] hover:bg-[#363849] px-3 py-2 rounded-lg text-sm font-bold">📊 Stats</button>
          </div>
          <p className="text-center mb-4">Select Players ({selectedPlayers.length} selected)</p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {availablePlayers.map((playerName) => (
              <button key={playerName} onClick={() => togglePlayerSelection(playerName)}
                className={`p-4 rounded-lg font-semibold text-lg transition-all ${selectedPlayers.includes(playerName) ? 'bg-[#05e5af] text-[#14151d] ring-4 ring-[#6ff0d2]' : 'bg-[#4b4e63] hover:bg-[#363849]'}`}>
                {playerName}
                {selectedPlayers.includes(playerName) && <div className="text-sm mt-1">✓ #{selectedPlayers.indexOf(playerName) + 1}</div>}
              </button>
            ))}
          </div>
          <button onClick={startGame} disabled={selectedPlayers.length < 2}
            className="w-full bg-[#ff8736] hover:bg-[#e6752b] text-[#14151d] p-4 rounded-lg font-bold text-xl disabled:opacity-50 disabled:cursor-not-allowed">
            Start Game
          </button>
          {selectedPlayers.length < 2 && <p className="text-center text-sm text-red-300 mt-3">Select at least 2 players</p>}
        </div>
      </div>
    );
  }

  // ── In-game screen ────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${isAbrahamClinkin ? 'bg-gradient-to-br from-red-900 via-orange-900 to-yellow-900 animate-pulse' : 'bg-gradient-to-br from-[#1d1f2c] to-[#0e0f16]'} text-white p-4`}>
      <style>{styles}</style>
      <div className="max-w-4xl mx-auto">

        {/* Death Roll Modal */}
        {showDiceRoll && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-red-700 p-8 rounded-2xl text-center max-w-md w-full mx-4 shadow-2xl">
              <h2 className="text-3xl font-bold mb-2">💀 DEATH ROLL 💀</h2>
              <p className="text-lg text-red-300 mb-2">{players[rollingPlayer]?.name} scratched on the {targetBall === 8 ? '8' : '15'} ball!</p>
              <div className="text-xs text-gray-500 mb-5">1-in-6 chance of death</div>
              <div className="min-h-32 flex flex-col items-center justify-center mb-6">
                {!diceRolling && diceResult === null && <div className="text-7xl animate-bounce">🎲</div>}
                {diceRolling && <div className="dice-roll-anim text-7xl">🎲</div>}
                {diceResult !== null && (
                  <>
                    <div className="text-8xl mb-3 animate-bounce">{diceResult === 'ghost' ? '👻' : '😊'}</div>
                    <div className={`text-2xl font-black ${diceResult === 'ghost' ? 'text-red-400' : 'text-green-400'}`}>
                      {diceResult === 'ghost' ? 'DEAD! 💀' : 'SAFE! ✨'}
                    </div>
                    <div className="text-sm text-gray-400 mt-2">
                      {diceResult === 'ghost' ? `${players[rollingPlayer]?.name} is eliminated!` : `${players[rollingPlayer]?.name} survives!`}
                    </div>
                  </>
                )}
              </div>
              {!diceRolling && diceResult === null && (
                <button onClick={rollDice} className="w-full bg-red-600 hover:bg-red-500 px-8 py-4 rounded-xl font-bold text-xl">🎲 ROLL THE DICE</button>
              )}
              {diceRolling && <div className="text-gray-400 text-lg font-semibold animate-pulse">Rolling...</div>}
              {diceResult !== null && <div className="text-gray-500 text-sm animate-pulse mt-2">Resolving...</div>}
            </div>
          </div>
        )}

        {/* Fatality Overlay */}
        {showFatality && (
          <div
            onClick={finishFatality}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black bg-opacity-90 overflow-hidden fatality-shake cursor-pointer"
          >
            <StickFigure anim={fatalityAnim} />
            <div className="fatality-text text-center mt-2 px-4">
              <div
                className="text-6xl sm:text-7xl font-black tracking-wider"
                style={{ color: "#ff0033", textShadow: "0 0 20px rgba(255,0,40,0.8), 3px 3px 0 #000" }}
              >
                FATALITY
              </div>
              <div className="text-xl font-bold text-white mt-2">
                {players[rollingPlayer]?.name} has been eliminated
              </div>
              <div className="text-xs text-[#c9c6be] mt-3">(tap to continue)</div>
            </div>
          </div>
        )}

        {/* Coin Flip Modal */}
        {showCoinFlip && (
          <div className="fixed inset-0 bg-black bg-opacity-85 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-[#ff66cc] p-8 rounded-2xl text-center max-w-sm w-full mx-4 shadow-2xl">
              <div className="text-[#ff66cc] font-black text-2xl mb-1">🐱 SCHRÖDINGER'S</div>
              <div className="text-[#ff66cc] font-black text-2xl mb-5">DOUBLE TAP 🐱</div>
              <div className="min-h-32 flex flex-col items-center justify-center mb-5">
                {!coinFlipping && coinResult === null && <div className="text-7xl">🪙</div>}
                {coinFlipping && <div className="coin-flip-anim text-7xl">🪙</div>}
                {coinResult !== null && (
                  <>
                    <div className="text-7xl mb-3 animate-bounce">{coinResult === 'single' ? '1️⃣' : '2️⃣'}</div>
                    <div className={`text-2xl font-black ${coinResult === 'single' ? 'text-green-400' : 'text-orange-400'}`}>
                      {coinResult === 'single' ? '✅ SINGLE TAP' : '⚡⚡ DOUBLE TAP'}
                    </div>
                    <div className="text-sm text-gray-400 mt-2">
                      {coinResult === 'single' ? 'Turn ends normally' : 'Next player is skipped!'}
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-5">
                <div className="bg-gray-800 p-2 rounded"><div className="text-green-400 font-bold mb-1">HEADS</div><div>Single Tap — end turn normally</div></div>
                <div className="bg-gray-800 p-2 rounded"><div className="text-orange-400 font-bold mb-1">TAILS</div><div>Double Tap — skip next player</div></div>
              </div>
              {!coinFlipping && coinResult === null && (
                <button onClick={flipCoin} className="w-full bg-[#ff66cc] hover:bg-[#e654b8] text-[#14151d] px-6 py-4 rounded-xl font-black text-lg">🪙 FLIP THE COIN</button>
              )}
              {coinFlipping && <div className="text-gray-400 text-lg font-semibold animate-pulse">Flipping...</div>}
              {coinResult !== null && <div className="text-gray-500 text-sm animate-pulse mt-2">Resolving...</div>}
            </div>
          </div>
        )}

        {/* End Game Early Confirmation Modal */}
        {showEndGameConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-orange-500 p-8 rounded-2xl text-center max-w-sm w-full mx-4 shadow-2xl">
              <div className="text-4xl mb-3">⏱️</div>
              <h2 className="text-2xl font-bold mb-2">End Game Early?</h2>
              <p className="text-gray-300 mb-6">This will end the game now and declare a winner based on current scores.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowEndGameConfirm(false)} className="bg-gray-700 hover:bg-gray-600 p-3 rounded-lg font-semibold">Cancel</button>
                <button onClick={() => { setGameEndedEarly(true); setShowEndGameConfirm(false); }} className="bg-orange-600 hover:bg-orange-500 p-3 rounded-lg font-bold">End Game</button>
              </div>
            </div>
          </div>
        )}

        {/* Abraham Clinkin overlay */}
        {isAbrahamClinkin && (
          <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-40">
            <div className="bg-gradient-to-r from-red-600 via-yellow-500 to-red-600 text-black px-12 py-8 rounded-lg shadow-2xl transform rotate-[-5deg] border-8 border-yellow-300 animate-bounce">
              <div className="flex justify-center gap-8 mb-4"><div className="text-8xl">🥂</div><div className="text-8xl">🥂</div></div>
              <div className="text-6xl font-black text-center mb-2">⚡ ABRAHAM ⚡</div>
              <div className="text-6xl font-black text-center">CLINKIN'!!!</div>
              <div className="text-2xl text-center mt-3 font-bold">ALL OR NOTHING!</div>
            </div>
          </div>
        )}

        {/* Manage Players Modal */}
        {showManagePlayers && (
          <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-[#63667d] p-6 rounded-2xl max-w-sm w-full mx-4 shadow-2xl">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-xl font-black">👥 Manage Players</h2>
                <button onClick={() => { setShowManagePlayers(false); setConfirmRemove(null); }}
                  className="text-gray-400 hover:text-white text-2xl font-bold">✕</button>
              </div>

              {/* Current players */}
              <div className="mb-5">
                <div className="text-xs text-[#c9c6be] font-semibold mb-2 uppercase tracking-wide">In Game</div>
                <div className="space-y-2">
                  {players.map((player, index) => (
                    <div key={player.id} className="flex items-center justify-between bg-[#282a3b] px-3 py-2 rounded-lg">
                      <div>
                        <span className="font-semibold">{player.name}</span>
                        <span className="text-[#c9c6be] text-sm ml-2">{player.score} pts</span>
                        {player.isDead && <span className="text-red-400 text-xs ml-2">💀</span>}
                      </div>
                      <div className="flex gap-2 items-center">
                        {!player.isDead && (
                          <button onClick={() => manualKillPlayer(index)}
                            title="Kill player on command"
                            className="text-xs bg-red-800 hover:bg-red-600 px-2 py-1 rounded text-red-300 hover:text-white font-bold">
                            💀 Kill
                          </button>
                        )}
                        {confirmRemove === index ? (
                          <div className="flex gap-2">
                            <button onClick={() => setConfirmRemove(null)} className="text-xs bg-gray-600 px-2 py-1 rounded">Cancel</button>
                            <button onClick={() => removePlayer(index)} className="text-xs bg-red-600 px-2 py-1 rounded font-bold">Remove</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmRemove(index)}
                            className="text-xs bg-red-800 hover:bg-red-600 px-2 py-1 rounded text-red-300 hover:text-white">✕</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add players */}
              {availablePlayers.filter(name => !players.find(p => p.name === name)).length > 0 && (
                <div>
                  <div className="text-xs text-[#c9c6be] font-semibold mb-2 uppercase tracking-wide">
                    Add Player — starts at {players.length > 0 ? Math.min(...players.map(p => p.score)) : 0} pts
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {availablePlayers
                      .filter(name => !players.find(p => p.name === name))
                      .map(name => (
                        <button key={name} onClick={() => addPlayer(name)}
                          className="bg-green-700 hover:bg-green-600 px-3 py-2 rounded-lg text-sm font-semibold text-left">
                          + {name}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-[#05e5af]">New Game +</h1>
          <div className="flex gap-2 items-center">
            <button onClick={() => setShowStats(true)} className="p-2 bg-[#4b4e63] hover:bg-[#63667d] rounded-lg text-sm font-bold">📊</button>
            {!winner && <button onClick={() => { setShowManagePlayers(true); setConfirmRemove(null); }} className="p-2 bg-[#4b4e63] hover:bg-[#63667d] rounded-lg text-sm font-bold">👥</button>}
            <button onClick={undo} disabled={history.length === 0} className="p-2 bg-yellow-600 rounded-lg disabled:opacity-50 text-sm font-bold">↩ Undo</button>
            {!winner && <button onClick={() => setShowEndGameConfirm(true)} className="p-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold">⏱️ End</button>}
            <button onClick={resetGame} className="p-2 bg-red-600 rounded-lg text-sm font-bold">↺ Reset</button>
          </div>
        </div>

        {!winner && currentPlayer && (
          <>
            <div className="bg-[#282a3b] p-4 rounded-lg mb-4">
              <div className="text-lg font-bold text-center mb-1">{currentPlayer.name}'s Turn</div>
              {currentPlayer.poisonLevel === 2 && <div className="text-center text-[#c9c6be] text-sm">⚠️⚠️ Double Poisoned! Lose 10 points this turn</div>}
              {currentPlayer.poisonLevel === 1 && <div className="text-center text-red-300 text-sm">⚠️ Poisoned! Lose 5 points this turn</div>}
            </div>
            <div className="bg-[#282a3b] p-4 rounded-lg mb-4 text-center">
              <div className="text-2xl font-bold">Target Ball: {targetBall}</div>
            </div>
          </>
        )}

        {/* Winner banner */}
        {winner && (
          <div className="bg-[#282a3b] p-4 rounded-lg mb-4 text-center py-6">
            <div className="text-5xl font-black mb-4 text-[#05e5af]">GG's Joe!</div>
            <div className="text-4xl mb-3">🎉 🏆 🎉</div>
            {gameEndedEarly && <div className="text-orange-300 text-sm mb-2">⏱️ Game ended early</div>}
            <div className="text-3xl font-bold mb-2">{winner.name} WINS!</div>
            <div className="text-xl mb-4">Final Score: {winner.score} points</div>
            <div className="text-sm text-[#c9c6be]">Final Standings:</div>
            <div className="mt-2 space-y-1">
              {[...players].sort((a, b) => b.score - a.score).map((player, index) => (
                <div key={player.id} className="text-lg">{index + 1}. {player.name}: {player.score} pts</div>
              ))}
            </div>
            <div className="mt-4 text-sm min-h-6">
              {savingGame && <div className="text-[#c9c6be] animate-pulse">💾 Saving game to stats...</div>}
              {gameSaved && <div className="text-green-400">✓ Game saved to stats</div>}
              {saveError && (
                <div className="text-red-400">
                  ⚠️ Couldn't save: {saveError}
                  <button onClick={() => saveGameToSupabase(players, gameEndedEarly, targetBall, shotLog)}
                    className="ml-2 underline text-orange-300">Retry</button>
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-center mt-4">
              <button onClick={resetGame} className="bg-[#ff8736] hover:bg-[#e6752b] text-[#14151d] px-8 py-3 rounded-lg font-bold text-lg">New Game</button>
              <button onClick={() => setShowStats(true)} className="bg-[#4b4e63] hover:bg-[#63667d] px-6 py-3 rounded-lg font-bold text-lg">📊 Stats</button>
            </div>
          </div>
        )}

        {/* Player Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {players.map((player, index) => {
            const storyline = playerStorylines[player.name];
            const storylineClass = storyline
              ? storyline.kind === 'hot'
                ? (storyline.tier === 2 ? 'storyline-hot-2' : 'storyline-hot-1')
                : (storyline.tier === 2 ? 'storyline-cold-2' : 'storyline-cold-1')
              : '';
            return (
            <div key={player.id} className={`p-3 rounded-lg ${
              player.isDead ? 'bg-gray-800 opacity-60' :
              index === currentPlayerIndex && !winner ? 'bg-yellow-500 text-black ring-4 ring-yellow-300' : 'bg-[#282a3b]'
            } ${gamblingPlayers.includes(index) ? 'ring-4 ring-green-400' : ''} ${player.isDead ? '' : storylineClass}`}>
              <div className="flex items-center justify-between mb-1">
                <input type="text" value={player.name} onChange={(e) => updatePlayerName(index, e.target.value)}
                  className="bg-transparent font-semibold w-full outline-none text-sm" disabled={player.isDead} />
                <div className="flex gap-1 ml-2">
                  <button onClick={() => togglePoison(index)} disabled={player.isDead}
                    className={`px-2 py-1 rounded text-xs font-bold ${(player.poisonLevel || 0) === 2 ? 'bg-[#4b4e63] text-white' : player.isPoisoned ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'} disabled:opacity-30`}>
                    {(player.poisonLevel || 0) === 2 ? '☠️☠️' : '☠️'}
                  </button>
                  <button onClick={() => toggleGamble(index)} disabled={index === currentPlayerIndex || player.isDead}
                    className={`px-2 py-1 rounded text-xs font-bold ${gamblingPlayers.includes(index) ? 'bg-green-600 text-white' : index === currentPlayerIndex || player.isDead ? 'bg-gray-400 text-gray-600 cursor-not-allowed' : 'bg-gray-600 text-white'}`}>
                    🎲
                  </button>
                </div>
              </div>

              {editingScore === index ? (
                <div className="flex gap-1 items-center">
                  <input type="number" defaultValue={player.score}
                    onKeyDown={(e) => { if (e.key === 'Enter') updatePlayerScore(index, parseInt(e.target.value) || 0); else if (e.key === 'Escape') setEditingScore(null); }}
                    className="bg-gray-700 text-white p-1 rounded w-20 text-2xl font-bold" autoFocus />
                  <button onClick={(e) => updatePlayerScore(index, parseInt(e.target.previousSibling.value) || 0)} className="bg-green-600 px-2 py-1 rounded text-xs">✓</button>
                </div>
              ) : (
                <div onClick={() => setEditingScore(index)} className="text-3xl font-bold cursor-pointer hover:opacity-80" title="Click to edit">{player.score}</div>
              )}

              {storyline && !player.isDead && (
                <div className={`text-[11px] font-black mt-0.5 ${storyline.kind === 'hot' ? 'text-[#ff8736]' : 'text-[#9fb4d1]'}`}>
                  {storyline.label}
                </div>
              )}

              <div className="flex gap-2 text-xs mt-1 items-center flex-wrap">
                {player.isDead && (
                  <>
                    <div className="font-bold text-red-400">💀 DEAD</div>
                    <button onClick={() => revivePlayer(index)}
                      className="ml-auto bg-green-700 hover:bg-green-600 px-2 py-1 rounded text-xs font-bold text-white">
                      💉 Revive
                    </button>
                  </>
                )}
                {player.poisonLevel === 2 && !player.isDead && <div className="font-semibold text-[#4fd8ac]">DOUBLE POISON</div>}
                {player.poisonLevel === 1 && !player.isDead && <div className="font-semibold text-red-400">POISONED</div>}
                {gamblingPlayers.includes(index) && !player.isDead && <div className="font-semibold text-green-400">GAMBLING</div>}
              </div>
            </div>
            );
          })}
        </div>

        {!winner && (
          <>
            {gamblingPlayers.length > 0 && (
              <div className={`${isAbrahamClinkin ? 'bg-gradient-to-r from-red-700 to-orange-700 ring-4 ring-yellow-400' : 'bg-green-700'} p-4 rounded-lg mb-4`}>
                {isAbrahamClinkin ? (
                  <>
                    <h3 className="font-black mb-3 text-center text-2xl">🔥 ABRAHAM CLINKIN' 🔥</h3>
                    <div className="text-center mb-3 font-semibold">{currentPlayer.name} vs EVERYONE ELSE!</div>
                    <div className="space-y-2">
                      <button onClick={() => resolveAbrahamClinkin('made')} className="w-full bg-yellow-500 text-black p-4 rounded-lg font-black text-lg">
                        ⚡ MADE IT!<div className="text-sm font-semibold">{currentPlayer.name} steals {targetBall}pts from each!</div>
                      </button>
                      <button onClick={() => resolveAbrahamClinkin('noScratch')} className="w-full bg-orange-600 p-4 rounded-lg font-black text-lg">
                        😐 NO SCRATCH<div className="text-sm font-semibold">Gamblers lose {targetBall}pts, {currentPlayer.name} gets {targetBall}pts</div>
                      </button>
                      <button onClick={() => resolveAbrahamClinkin('scratch')} className="w-full bg-red-600 p-4 rounded-lg font-black text-lg">
                        💥 SCRATCHED!<div className="text-sm font-semibold">Gamblers get +{targetBall}pts, apply scratch separately</div>
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="font-semibold mb-2 text-center">🎲 {gamblingPlayers.length} Player{gamblingPlayers.length > 1 ? 's' : ''} Gambling</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => resolveGamble(true)} className="bg-green-600 p-3 rounded-lg font-semibold">✓ They Won (+{targetBall} pts)</button>
                      <button onClick={() => resolveGamble(false)} className="bg-red-600 p-3 rounded-lg font-semibold">✗ They Lost (-{targetBall} pts)</button>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="space-y-3">
              <button onClick={endTurn} className="w-full bg-[#4b4e63] p-4 rounded-lg font-semibold text-lg">End Turn</button>

              <div className="bg-green-700 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">✓ Success</h3>
                <div className="space-y-2">
                  <button onClick={hitTargetBall} className="w-full bg-green-600 p-3 rounded-lg font-semibold">Hit Target Ball #{targetBall} (+{targetBall} pts)</button>
                  <button onClick={ricochetShot} className="w-full bg-green-500 p-3 rounded-lg font-semibold">🎯 Ricochet Ball #{targetBall} (+{targetBall * 2} pts)</button>
                </div>
              </div>

              <div className="bg-red-700 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">✗ Scratches</h3>
                <div className="space-y-2">
                  <ScratchBallSelector onSelectBall={scratchOnBall} label="Hit Wrong Ball" />
                  <ScratchBallSelector onSelectBall={scratchBallAndPocket} label="Wrong Ball + Pocket" />
                </div>
              </div>

              <div className="bg-orange-700 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">🎯 Parlay Points</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs mb-1 text-center">Add Points</div>
                    <div className="grid grid-cols-3 gap-1">
                      {[5, 8, 11].map(p => <button key={p} onClick={() => addParlayPoints(p)} className="bg-green-600 p-2 rounded font-semibold text-sm">+{p}</button>)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs mb-1 text-center">Remove Points</div>
                    <div className="grid grid-cols-3 gap-1">
                      {[5, 8, 11].map(p => <button key={p} onClick={() => removeParlayPoints(p)} className="bg-red-600 p-2 rounded font-semibold text-sm">-{p}</button>)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-blue-700 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">⚡ Special</h3>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button onClick={doubleTap} className="bg-blue-600 p-3 rounded-lg font-semibold text-sm">⚡⚡ Double Tap</button>
                  <button onClick={tripleTap} className="bg-[#4b4e63] p-3 rounded-lg font-semibold text-sm">⚡⚡⚡ Triple Tap</button>
                </div>
                <button onClick={schrodingerDoubleTap}
                  className="w-full bg-[#a3477f] hover:bg-[#8f3d6e] p-3 rounded-lg font-semibold text-sm border border-[#ff66cc] transition-colors">
                  🐱 Schrödinger's Double Tap
                  <div className="text-xs text-[#ffa3e0] font-normal mt-1">50/50 — single tap or double tap?</div>
                </button>
                <div className="text-xs text-blue-200 text-center mt-2">💡 Tip: Click ☠️ on player cards to toggle poison status</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
