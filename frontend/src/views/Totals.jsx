import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

async function fetchOUGames() {
  const r = await fetch(`${API}/api/ou-games`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchOUPerformance() {
  const r = await fetch(`${API}/api/ou-performance`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function fmt(ct) {
  if (!ct) return '—';
  const d = new Date(ct);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="border border-border rounded p-4">
      <div className="text-text-dim text-[10px] uppercase tracking-widest mb-1">{label}</div>
      <div className="text-2xl font-bold text-text">{value ?? '—'}</div>
      {sub && <div className="text-text-dim text-xs mt-1">{sub}</div>}
    </div>
  );
}

function OUCard({ game }) {
  const started = new Date(game.commence_time) <= new Date();
  const hasModel = game.model_total != null;
  const isValue = game.ou_value;

  return (
    <div className={`border rounded p-4 space-y-3 ${
      isValue ? 'border-neon/60 bg-neon/5' : 'border-border bg-card'
    } ${started ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-text-dim uppercase tracking-wider">{fmt(game.commence_time)}</div>
        {isValue && (
          <span className="text-[10px] bg-neon/20 text-neon border border-neon/30 rounded px-2 py-0.5 uppercase tracking-wider font-bold">
            Value
          </span>
        )}
      </div>

      {/* Teams */}
      <div className="space-y-1">
        <div className="text-sm font-semibold text-text">{game.away_team}</div>
        <div className="text-text-dim text-xs">@ {game.home_team}</div>
      </div>

      {/* Totals grid */}
      {hasModel ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="border border-border rounded p-2">
            <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Model Total</div>
            <div className="text-lg font-bold text-text">{game.model_total}</div>
          </div>
          <div className="border border-border rounded p-2">
            <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Market O/U</div>
            <div className="text-lg font-bold text-text">{game.consensus_total}</div>
          </div>
          <div className={`border rounded p-2 ${
            isValue
              ? game.ou_pick === 'over'
                ? 'border-neon/50 bg-neon/10'
                : 'border-blue/50 bg-blue/10'
              : 'border-border'
          }`}>
            <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Pick</div>
            <div className={`text-lg font-bold uppercase ${
              game.ou_pick === 'over' ? 'text-neon' : 'text-blue'
            }`}>{game.ou_pick}</div>
          </div>
        </div>
      ) : (
        <div className="text-text-dim text-xs">No model data available</div>
      )}

      {/* Edge + breakdown */}
      {hasModel && (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between text-text-dim">
            <span>Edge</span>
            <span className={Math.abs(game.ou_edge) >= 2 ? 'text-neon font-semibold' : 'text-text'}>
              {game.ou_edge > 0 ? '+' : ''}{game.ou_edge} pts
              {' '}({game.ou_pick === 'over' ? 'model sees more scoring' : 'model sees less scoring'})
            </span>
          </div>
          {game.avg_tempo && (
            <div className="flex justify-between text-text-dim">
              <span>Avg Tempo</span>
              <span>{game.avg_tempo} poss/game</span>
            </div>
          )}
          {game.home_exp_oe && game.away_exp_oe && (
            <div className="flex justify-between text-text-dim">
              <span>Exp Offense</span>
              <span>{game.home_exp_oe} / {game.away_exp_oe} (per 100)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OULogRow({ game }) {
  const resultColor = {
    won: 'text-neon',
    lost: 'text-red',
    push: 'text-yellow',
    pending: 'text-text-dim',
  }[game.ou_result] || 'text-text-dim';

  const actualTotal = game.home_score != null ? game.home_score + game.away_score : null;

  return (
    <tr className="border-b border-border/40 hover:bg-border/10 transition-colors">
      <td className="px-3 py-2 text-xs text-text-dim whitespace-nowrap">
        {new Date(game.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </td>
      <td className="px-3 py-2 text-xs">
        <div>{game.away_team}</div>
        <div className="text-text-dim">@ {game.home_team}</div>
      </td>
      <td className="px-3 py-2 text-xs text-center">{game.model_total ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-center">{game.consensus_total ?? '—'}</td>
      <td className="px-3 py-2 text-xs text-center">
        {game.ou_pick ? (
          <span className={`uppercase font-semibold ${game.ou_pick === 'over' ? 'text-neon' : 'text-blue'}`}>
            {game.ou_pick}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-2 text-xs text-center">
        {game.ou_value ? <span className="text-neon text-[10px] font-bold">VALUE</span> : <span className="text-text-dim">—</span>}
      </td>
      <td className="px-3 py-2 text-xs text-center">{actualTotal ?? '—'}</td>
      <td className={`px-3 py-2 text-xs text-center font-semibold ${resultColor}`}>
        {game.ou_result === 'won' ? 'W' :
         game.ou_result === 'lost' ? 'L' :
         game.ou_result === 'push' ? 'P' :
         game.ou_result === 'pending' ? '—' : '—'}
      </td>
    </tr>
  );
}

export default function Totals() {
  const [gamesData, setGamesData] = useState(null);
  const [perfData, setPerfData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [onlyValue, setOnlyValue] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);
  const [tab, setTab] = useState('games'); // 'games' | 'history'

  useEffect(() => {
    Promise.all([fetchOUGames(), fetchOUPerformance()])
      .then(([g, p]) => { setGamesData(g); setPerfData(p); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const games = gamesData?.games || [];
  const stats = perfData?.stats || {};
  const gameLog = perfData?.game_log || [];
  const cal = gamesData?.calibration;

  const filteredGames = games.filter((g) => {
    if (onlyValue && !g.ou_value) return false;
    if (onlyToday) {
      const today = new Date().toLocaleDateString();
      if (new Date(g.commence_time).toLocaleDateString() !== today) return false;
    }
    return true;
  });

  const valueGames = games.filter((g) => g.ou_value);

  if (loading) return <div className="text-text-dim text-sm p-8">Loading O/U model...</div>;
  if (error) return <div className="text-red text-sm p-8">Error: {error}</div>;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Games Tracked" value={stats.games_completed ?? 0} sub={`${stats.games_pending ?? 0} pending`} />
        <StatCard label="Model MAE" value={stats.mae != null ? `${stats.mae} pts` : null} sub="avg miss vs actual total" />
        <StatCard
          label="All Picks W/R"
          value={stats.win_rate_pct != null ? `${stats.win_rate_pct}%` : null}
          sub={stats.games_completed ? `${stats.wins}/${stats.games_completed}` : null}
        />
        <StatCard
          label="Value Bets W/R"
          value={stats.value_win_rate_pct != null ? `${stats.value_win_rate_pct}%` : null}
          sub={stats.value_completed ? `${stats.value_wins}/${stats.value_completed}` : null}
        />
      </div>

      {/* Calibration info */}
      {cal && (
        <div className="text-[10px] text-text-dim border border-border/40 rounded px-3 py-2 inline-flex gap-4">
          <span>Model calibration — slope: <span className="text-text">{cal.slope}</span></span>
          <span>intercept: <span className="text-text">{cal.intercept}</span></span>
          <span className="text-text-dim italic">fitted to historical game totals</span>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-border">
        {[
          { id: 'games', label: `Upcoming (${games.length})` },
          { id: 'history', label: `History (${gameLog.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs uppercase tracking-wider transition-colors cursor-pointer ${
              tab === t.id
                ? 'text-neon border-b-2 border-neon -mb-px'
                : 'text-text-dim hover:text-text border-b-2 border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'games' && (
        <>
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setOnlyValue((v) => !v)}
              className={`text-[10px] border rounded px-2 py-1 transition-colors cursor-pointer ${
                onlyValue ? 'text-neon border-neon' : 'text-text-dim border-border hover:text-text'
              }`}
            >
              Value Bets ({valueGames.length})
            </button>
            <button
              onClick={() => setOnlyToday((v) => !v)}
              className={`text-[10px] border rounded px-2 py-1 transition-colors cursor-pointer ${
                onlyToday ? 'text-neon border-neon' : 'text-text-dim border-border hover:text-text'
              }`}
            >
              Today
            </button>
          </div>

          {/* Game cards */}
          {filteredGames.length === 0 ? (
            <div className="text-text-dim text-sm">No games match your filters.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredGames.map((g) => <OUCard key={g.id} game={g} />)}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        gameLog.length === 0 ? (
          <div className="text-text-dim text-sm">No completed O/U predictions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-text-dim text-[10px] uppercase tracking-wider">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2 text-center">Model</th>
                  <th className="px-3 py-2 text-center">Market</th>
                  <th className="px-3 py-2 text-center">Pick</th>
                  <th className="px-3 py-2 text-center">Value</th>
                  <th className="px-3 py-2 text-center">Actual</th>
                  <th className="px-3 py-2 text-center">Result</th>
                </tr>
              </thead>
              <tbody>
                {gameLog.map((g) => <OULogRow key={g.game_id} game={g} />)}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
