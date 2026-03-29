import { useState, useEffect, useCallback } from "react";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
// Replace these with your actual Supabase project values after setup
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
      if (opts.limit) url += `&limit=${opts.limit}`;
      if (opts.filter) url += `&${opts.filter}`;
      const res = await fetch(url, {
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      const data = await res.json();
      return { data: res.ok ? data : [], error: res.ok ? null : data };
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

const StatCard = ({ label, value, sub, color = "purple" }) => {
  const colors = {
    purple: "bg-purple-800", green: "bg-green-800",
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

const StatsView = ({ onBack }) => {
  const [stats, setStats] = useState([]);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("leaderboard");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [gamesRes, resultsRes, shotsRes] = await Promise.all([
          supabase.from("games").select("*", { order: "played_at.desc", limit: 50 }),
          supabase.from("game_results").select("*"),
          supabase.from("shots").select("*"),
        ]);

        if (gamesRes.error) throw new Error("Could not load games");

        const allGames = gamesRes.data || [];
        const allResults = resultsRes.data || [];
        const allShots = shotsRes.data || [];

        setGames(allGames);

        // Aggregate per-player stats
        const playerMap = {};
        allResults.forEach(r => {
          if (!playerMap[r.player_name]) {
            playerMap[r.player_name] = {
              name: r.player_name,
              games: 0, wins: 0, totalScore: 0, bestScore: -Infinity,
              totalBallsPocketed: 0, totalRicochets: 0,
              totalScratches: 0, totalDeathRolls: 0, totalDeaths: 0,
              placements: [],
            };
          }
          const p = playerMap[r.player_name];
          p.games++;
          if (r.placement === 1) p.wins++;
          p.totalScore += r.final_score;
          if (r.final_score > p.bestScore) p.bestScore = r.final_score;
          p.placements.push(r.placement);
        });

        allShots.forEach(s => {
          if (!playerMap[s.player_name]) return;
          const p = playerMap[s.player_name];
          if (s.shot_type === "hit") p.totalBallsPocketed++;
          if (s.shot_type === "ricochet") { p.totalBallsPocketed++; p.totalRicochets++; }
          if (s.shot_type === "scratch" || s.shot_type === "scratch_pocket") p.totalScratches++;
          if (s.shot_type === "death_roll") p.totalDeathRolls++;
          if (s.shot_type === "death_roll" && s.result === "ghost") p.totalDeaths++;
        });

        const compiled = Object.values(playerMap).map(p => ({
          ...p,
          winRate: p.games > 0 ? ((p.wins / p.games) * 100).toFixed(0) : 0,
          avgScore: p.games > 0 ? (p.totalScore / p.games).toFixed(0) : 0,
          avgPlacement: p.placements.length > 0
            ? (p.placements.reduce((a, b) => a + b, 0) / p.placements.length).toFixed(1)
            : null,
        }));

        compiled.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);
        setStats(compiled);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const tabs = ["leaderboard", "per-player", "recent games"];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 to-blue-900 text-white p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="bg-purple-700 hover:bg-purple-600 px-3 py-2 rounded-lg text-sm font-bold">← Back</button>
          <h1 className="text-2xl font-black">📊 All-Time Stats</h1>
        </div>

        {loading && <div className="text-center py-16 text-purple-300 animate-pulse text-xl">Loading stats...</div>}
        {error && (
          <div className="bg-red-900 border border-red-500 p-4 rounded-lg mb-4">
            <div className="font-bold mb-1">⚠️ Could not connect to database</div>
            <div className="text-sm text-red-300">{error}</div>
            <div className="text-xs text-red-400 mt-2">Check your Supabase credentials in the config at the top of the file.</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Tab bar */}
            <div className="flex gap-2 mb-6 bg-purple-950 p-1 rounded-lg">
              {tabs.map(t => (
                <button key={t} onClick={() => setActiveTab(t)}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-semibold capitalize transition-all ${activeTab === t ? 'bg-purple-600 text-white' : 'text-purple-300 hover:text-white'}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* LEADERBOARD TAB */}
            {activeTab === "leaderboard" && (
              <div className="space-y-3">
                {stats.length === 0 && <div className="text-center py-12 text-purple-400">No games recorded yet. Play some games!</div>}
                {stats.map((p, i) => (
                  <div key={p.name} className={`p-4 rounded-xl ${i === 0 ? 'bg-yellow-700 ring-2 ring-yellow-400' : 'bg-purple-800'}`}>
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

            {/* PER-PLAYER TAB */}
            {activeTab === "per-player" && (
              <div className="space-y-4">
                {stats.length === 0 && <div className="text-center py-12 text-purple-400">No games recorded yet.</div>}
                {stats.map((p) => (
                  <div key={p.name} className="bg-purple-800 rounded-xl p-4">
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

            {/* RECENT GAMES TAB */}
            {activeTab === "recent games" && (
              <div className="space-y-3">
                {games.length === 0 && <div className="text-center py-12 text-purple-400">No games recorded yet.</div>}
                {games.map((g) => (
                  <div key={g.id} className="bg-purple-800 rounded-xl p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-bold">{g.player_names?.join(", ")}</div>
                        <div className="text-xs text-purple-300">{g.player_count} players · Ball {g.final_ball ?? "?"} reached</div>
                      </div>
                      <div className="text-right text-xs text-purple-400">
                        {g.played_at ? new Date(g.played_at).toLocaleDateString() : ""}
                        {g.ended_early && <div className="text-orange-400 font-semibold">⏱️ Early end</div>}
                      </div>
                    </div>
                    <div className="text-sm">
                      <span className="text-yellow-400 font-bold">🏆 {g.winner_name}</span>
                      <span className="text-gray-400 ml-2">— {g.winner_score} pts</span>
                    </div>
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

  const availablePlayers = [
    'Ryan', 'Joe', 'Gabby', 'Chase', 'Carlos', 'Spencer',
    'Shad', 'Rai', 'James', 'Mike', 'Heber', 'Zach'
  ];

  const logShot = useCallback((playerName, shotType, ballNumber = null, result = null) => {
    setShotLog(prev => [...prev, { player_name: playerName, shot_type: shotType, ball_number: ballNumber, result }]);
  }, []);

  const togglePlayerSelection = (playerName) => {
    if (selectedPlayers.includes(playerName)) {
      setSelectedPlayers(selectedPlayers.filter(p => p !== playerName));
    } else {
      if (selectedPlayers.length < 8) setSelectedPlayers([...selectedPlayers, playerName]);
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
        if (result === 'ghost') killPlayer(rollingPlayer);
        setShowDiceRoll(false);
        setDiceResult(null);
        setRollingPlayer(null);
      }, 2200);
    }, 1800);
  };

  const killPlayer = (playerIndex) => {
    const newPlayers = [...players];
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
    setPlayers(newPlayers);
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
          player.isDead = false;
          newPlayers[lowestAliveIndex].isDead = true;
          newPlayers[lowestAliveIndex].score = player.score - 10;
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
    newPlayers[index].score = newScore;
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
    logShot(players[currentPlayerIndex].name, 'hit', targetBall);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += targetBall;
    setPlayers(checkForResurrection(newPlayers));
    setTargetBall(t => t === 15 ? 16 : t + 1);
  };

  const ricochetShot = () => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'ricochet', targetBall);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += targetBall * 2;
    setPlayers(checkForResurrection(newPlayers));
    setTargetBall(t => t === 15 ? 16 : t + 1);
  };

  const scratchOnBall = (ballNumber) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'scratch', ballNumber);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score -= ballNumber;
    setPlayers(checkForResurrection(newPlayers));
    if (ballNumber === 8 || ballNumber === 15) triggerDeathRoll(currentPlayerIndex);
  };

  const scratchBallAndPocket = (ballNumber) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'scratch_pocket', ballNumber);
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
      logShot(players[i].name, won ? 'gamble_win' : 'gamble_loss', targetBall);
      newPlayers[i].score += won ? targetBall : -targetBall;
    });
    setPlayers(checkForResurrection(newPlayers));
    setGamblingPlayers([]);
  };

  const resolveAbrahamClinkin = (outcome) => {
    setHistory(h => [...h, saveState()]);
    const newPlayers = [...players];
    if (outcome === 'made') {
      gamblingPlayers.forEach(i => { newPlayers[i].score -= targetBall; });
      newPlayers[currentPlayerIndex].score += targetBall * gamblingPlayers.length;
    } else if (outcome === 'noScratch') {
      gamblingPlayers.forEach(i => { newPlayers[i].score -= targetBall; });
      newPlayers[currentPlayerIndex].score += targetBall;
    } else {
      gamblingPlayers.forEach(i => { newPlayers[i].score += targetBall; });
    }
    logShot(players[currentPlayerIndex].name, `abraham_clinkin_${outcome}`, targetBall);
    setPlayers(checkForResurrection(newPlayers));
    setGamblingPlayers([]);
  };

  const addParlayPoints = (pts) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'parlay_add', pts);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score += pts;
    setPlayers(newPlayers);
  };

  const removeParlayPoints = (pts) => {
    setHistory(h => [...h, saveState()]);
    logShot(players[currentPlayerIndex].name, 'parlay_remove', pts);
    const newPlayers = [...players];
    newPlayers[currentPlayerIndex].score -= pts;
    setPlayers(newPlayers);
  };

  const doSingleTap = (snapshot) => {
    const newPlayers = [...snapshot];
    const poisonLevel = newPlayers[currentPlayerIndex].poisonLevel || 0;
    if (poisonLevel > 0) newPlayers[currentPlayerIndex].score -= poisonLevel * 5;
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
    let next = (currentPlayerIndex + 2) % numPlayers;
    let safety = 0;
    while (players[next]?.isDead && next !== currentPlayerIndex && safety < numPlayers) {
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
    newPlayers[currentPlayerIndex].score *= -1;
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

  // ── Save game to Supabase ──────────────────────────────────────────────────
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
      <div className="min-h-screen bg-gradient-to-br from-purple-900 to-blue-900 text-white p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-purple-800 p-8 rounded-lg">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">New Game +</h1>
            <button onClick={() => setShowStats(true)} className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded-lg text-sm font-bold">📊 Stats</button>
          </div>
          <p className="text-center mb-4">Select Players ({selectedPlayers.length} selected)</p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {availablePlayers.map((playerName) => (
              <button key={playerName} onClick={() => togglePlayerSelection(playerName)}
                className={`p-4 rounded-lg font-semibold text-lg transition-all ${selectedPlayers.includes(playerName) ? 'bg-green-600 ring-4 ring-green-400' : 'bg-purple-600 hover:bg-purple-700'}`}>
                {playerName}
                {selectedPlayers.includes(playerName) && <div className="text-sm mt-1">✓ #{selectedPlayers.indexOf(playerName) + 1}</div>}
              </button>
            ))}
          </div>
          <button onClick={startGame} disabled={selectedPlayers.length < 2}
            className="w-full bg-yellow-500 hover:bg-yellow-600 text-black p-4 rounded-lg font-bold text-xl disabled:opacity-50 disabled:cursor-not-allowed">
            Start Game
          </button>
          {selectedPlayers.length < 2 && <p className="text-center text-sm text-red-300 mt-3">Select at least 2 players</p>}
        </div>
      </div>
    );
  }

  // ── In-game screen ────────────────────────────────────────────────────────
  return (
    <div className={`min-h-screen ${isAbrahamClinkin ? 'bg-gradient-to-br from-red-900 via-orange-900 to-yellow-900 animate-pulse' : 'bg-gradient-to-br from-purple-900 to-blue-900'} text-white p-4`}>
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

        {/* Coin Flip Modal */}
        {showCoinFlip && (
          <div className="fixed inset-0 bg-black bg-opacity-85 flex items-center justify-center z-50">
            <div className="bg-gray-900 border-2 border-indigo-500 p-8 rounded-2xl text-center max-w-sm w-full mx-4 shadow-2xl">
              <div className="text-indigo-300 font-black text-2xl mb-1">🐱 SCHRÖDINGER'S</div>
              <div className="text-indigo-300 font-black text-2xl mb-5">DOUBLE TAP 🐱</div>
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
                <button onClick={flipCoin} className="w-full bg-indigo-600 hover:bg-indigo-500 px-6 py-4 rounded-xl font-black text-lg">🪙 FLIP THE COIN</button>
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

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">New Game +</h1>
          <div className="flex gap-2">
            <button onClick={() => setShowStats(true)} className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-bold">📊</button>
            <button onClick={undo} disabled={history.length === 0} className="p-2 bg-yellow-600 rounded-lg disabled:opacity-50 text-sm font-bold">↩ Undo</button>
            {!winner && <button onClick={() => setShowEndGameConfirm(true)} className="p-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-bold">⏱️ End</button>}
            <button onClick={resetGame} className="p-2 bg-red-600 rounded-lg text-sm font-bold">↺ Reset</button>
          </div>
        </div>

        {!winner && currentPlayer && (
          <>
            <div className="bg-purple-800 p-4 rounded-lg mb-4">
              <div className="text-lg font-bold text-center mb-1">{currentPlayer.name}'s Turn</div>
              {currentPlayer.poisonLevel === 2 && <div className="text-center text-purple-300 text-sm">⚠️⚠️ Double Poisoned! Lose 10 points this turn</div>}
              {currentPlayer.poisonLevel === 1 && <div className="text-center text-red-300 text-sm">⚠️ Poisoned! Lose 5 points this turn</div>}
            </div>
            <div className="bg-purple-800 p-4 rounded-lg mb-4 text-center">
              <div className="text-2xl font-bold">Target Ball: {targetBall}</div>
            </div>
          </>
        )}

        {/* Winner banner */}
        {winner && (
          <div className="bg-purple-800 p-4 rounded-lg mb-4 text-center py-6">
            <div className="text-5xl font-black mb-4">GG's Joe!</div>
            <div className="text-4xl mb-3">🎉 🏆 🎉</div>
            {gameEndedEarly && <div className="text-orange-300 text-sm mb-2">⏱️ Game ended early</div>}
            <div className="text-3xl font-bold mb-2">{winner.name} WINS!</div>
            <div className="text-xl mb-4">Final Score: {winner.score} points</div>
            <div className="text-sm text-purple-300">Final Standings:</div>
            <div className="mt-2 space-y-1">
              {[...players].sort((a, b) => b.score - a.score).map((player, index) => (
                <div key={player.id} className="text-lg">{index + 1}. {player.name}: {player.score} pts</div>
              ))}
            </div>
            <div className="mt-4 text-sm min-h-6">
              {savingGame && <div className="text-purple-300 animate-pulse">💾 Saving game to stats...</div>}
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
              <button onClick={resetGame} className="bg-yellow-500 text-black px-8 py-3 rounded-lg font-bold text-lg">New Game</button>
              <button onClick={() => setShowStats(true)} className="bg-blue-600 px-6 py-3 rounded-lg font-bold text-lg">📊 Stats</button>
            </div>
          </div>
        )}

        {/* Player Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {players.map((player, index) => (
            <div key={player.id} className={`p-3 rounded-lg ${
              player.isDead ? 'bg-gray-800 opacity-60' :
              index === currentPlayerIndex && !winner ? 'bg-yellow-500 text-black ring-4 ring-yellow-300' : 'bg-purple-800'
            } ${gamblingPlayers.includes(index) ? 'ring-4 ring-green-400' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <input type="text" value={player.name} onChange={(e) => updatePlayerName(index, e.target.value)}
                  className="bg-transparent font-semibold w-full outline-none text-sm" disabled={player.isDead} />
                <div className="flex gap-1 ml-2">
                  <button onClick={() => togglePoison(index)} disabled={player.isDead}
                    className={`px-2 py-1 rounded text-xs font-bold ${(player.poisonLevel || 0) === 2 ? 'bg-purple-600 text-white' : player.isPoisoned ? 'bg-red-600 text-white' : 'bg-gray-600 text-white'} disabled:opacity-30`}>
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
                {player.poisonLevel === 2 && !player.isDead && <div className="font-semibold text-purple-400">DOUBLE POISON</div>}
                {player.poisonLevel === 1 && !player.isDead && <div className="font-semibold text-red-400">POISONED</div>}
                {gamblingPlayers.includes(index) && !player.isDead && <div className="font-semibold text-green-400">GAMBLING</div>}
              </div>
            </div>
          ))}
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
              <button onClick={endTurn} className="w-full bg-purple-600 p-4 rounded-lg font-semibold text-lg">End Turn</button>

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
                  <button onClick={tripleTap} className="bg-purple-600 p-3 rounded-lg font-semibold text-sm">⚡⚡⚡ Triple Tap</button>
                </div>
                <button onClick={schrodingerDoubleTap}
                  className="w-full bg-indigo-700 hover:bg-indigo-600 p-3 rounded-lg font-semibold text-sm border border-indigo-400 transition-colors">
                  🐱 Schrödinger's Double Tap
                  <div className="text-xs text-indigo-300 font-normal mt-1">50/50 — single tap or double tap?</div>
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
