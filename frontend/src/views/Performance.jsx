import { useState, useEffect } from 'react';
import { fetchPerformance } from '../api';

function StatCard({ label, value, sub, color = 'text-text' }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col gap-1">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>
        {value ?? <span className="text-text-dim text-base">—</span>}
      </div>
      <div className="text-[10px] text-text-dim uppercase tracking-widest">{label}</div>
      {sub && <div className="text-[10px] text-text-dim">{sub}</div>}
    </div>
  );
}

const RESULT_STYLES = {
  correct:   'text-neon',
  incorrect: 'text-red-400',
  pending:   'text-text-dim',
  push:      'text-yellow-400',
};

const VB_STYLES = {
  won:     'text-neon',
  lost:    'text-red-400',
  pending: 'text-text-dim',
};

function formatSpread(v) {
  if (v == null) return '—';
  return v > 0 ? `+${v}` : `${v}`;
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ─── Game Detail Panel ───────────────────────────────────────────────────────

function DetailPanel({ game, onClose }) {
  const homeName = game.home_torvik || game.home_team;
  const awayName = game.away_torvik || game.away_team;
  const homeWon = game.actual_margin > 0;
  const awayWon = game.actual_margin < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-5 border-b border-border rounded-t-xl ${
          game.value_bet_side ? 'bg-neon/5' : 'bg-surface'
        }`}>
          <div className="flex justify-between items-start mb-3">
            <div className="text-[10px] text-text-dim">{formatTime(game.commence_time)}</div>
            <button onClick={onClose} className="text-text-dim hover:text-text cursor-pointer text-lg leading-none">×</button>
          </div>
          <div className="flex items-center gap-3 text-lg mb-3">
            <span className={`font-bold ${awayWon ? 'text-neon' : 'text-text-dim'}`}>{awayName}</span>
            <span className="text-text-dim text-sm">@</span>
            <span className={`font-bold ${homeWon ? 'text-neon' : 'text-text-dim'}`}>{homeName}</span>
          </div>

          {/* Score */}
          {game.completed ? (
            <div className="flex items-center gap-4">
              <div className="text-2xl font-bold tabular-nums text-text">
                {game.away_score}
                <span className="text-text-dim mx-2 text-lg">–</span>
                {game.home_score}
              </div>
              <div className={`text-sm font-bold ${
                game.model_result === 'correct' ? 'text-neon' :
                game.model_result === 'incorrect' ? 'text-red-400' : 'text-yellow-400'
              }`}>
                Model {game.model_result === 'correct' ? 'W' : game.model_result === 'incorrect' ? 'L' : game.model_result}
              </div>
            </div>
          ) : (
            <div className="text-text-dim text-sm">Pending</div>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Spread comparison */}
          <div>
            <div className="text-[10px] text-text-dim uppercase tracking-widest mb-3">Spread Analysis</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-surface rounded-lg p-3">
                <div className="text-[9px] text-text-dim uppercase mb-1">Model</div>
                <div className={`text-xl font-bold tabular-nums ${
                  game.model_spread != null && game.model_spread < 0 ? 'text-neon' : 'text-blue'
                }`}>
                  {formatSpread(game.model_spread)}
                </div>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <div className="text-[9px] text-text-dim uppercase mb-1">Market</div>
                <div className="text-xl text-text tabular-nums">
                  {formatSpread(game.consensus_spread)}
                </div>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <div className="text-[9px] text-text-dim uppercase mb-1">Actual</div>
                <div className={`text-xl font-bold tabular-nums ${
                  game.actual_margin > 0 ? 'text-neon' : 'text-blue'
                }`}>
                  {game.actual_margin != null
                    ? (game.actual_margin > 0 ? `+${game.actual_margin}` : game.actual_margin)
                    : '—'}
                </div>
              </div>
            </div>
            {game.edge != null && (
              <div className="text-[10px] text-text-dim mt-2 text-center">
                Edge: <span className={game.credible ? 'text-neon' : 'text-text-dim'}>{game.edge} pts</span>
              </div>
            )}
          </div>

          {/* Win probability */}
          {game.home_win_pct != null && (
            <div>
              <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2">Win Probability</div>
              <div className="h-2 bg-surface rounded-full overflow-hidden flex mb-1">
                <div className="bg-neon/50 transition-all" style={{ width: `${game.home_win_pct}%` }} />
                <div className="bg-blue/50 transition-all" style={{ width: `${game.away_win_pct}%` }} />
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-neon">{homeName} {game.home_win_pct}%</span>
                <span className="text-blue">{awayName} {game.away_win_pct}%</span>
              </div>
            </div>
          )}

          {/* Monte Carlo */}
          {game.mc_mean_spread != null && (
            <div>
              <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2">Monte Carlo</div>
              <div className="bg-surface rounded-lg p-3 grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-[9px] text-text-dim uppercase mb-1">Mean</div>
                  <div className="text-sm tabular-nums text-text">{formatSpread(game.mc_mean_spread)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-text-dim uppercase mb-1">Std Dev</div>
                  <div className="text-sm tabular-nums text-text">±{game.mc_std_dev}</div>
                </div>
                <div>
                  <div className="text-[9px] text-text-dim uppercase mb-1">Home Win</div>
                  <div className="text-sm tabular-nums text-neon">{game.mc_home_win_pct}%</div>
                </div>
              </div>
            </div>
          )}

          {/* Value bet */}
          {game.value_bet_side && (
            <div>
              <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2">Value Bet</div>
              <div className={`rounded-lg p-3 border ${
                game.value_bet_result === 'won' ? 'border-neon/40 bg-neon/5' :
                game.value_bet_result === 'lost' ? 'border-red-400/40 bg-red-400/5' :
                'border-border bg-surface'
              }`}>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-text">
                    {(game.value_bet_side || '').replace(/ \w+$/, '')}
                  </span>
                  <span className={`text-sm font-bold ${
                    game.value_bet_result === 'won' ? 'text-neon' :
                    game.value_bet_result === 'lost' ? 'text-red-400' : 'text-text-dim'
                  }`}>
                    {game.value_bet_result === 'won' ? 'WON' :
                     game.value_bet_result === 'lost' ? 'LOST' : 'PENDING'}
                  </span>
                </div>
                <div className="text-[10px] text-text-dim mt-1">
                  +{game.value_bet_edge} pt edge
                  {game.value_bet_reason && ` · ${game.value_bet_reason}`}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Performance() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyValue, setOnlyValue] = useState(false);
  const [dayFilter, setDayFilter] = useState('all');

  const load = () => {
    setLoading(true);
    fetchPerformance()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const runBackfill = () => {
    setBackfilling(true);
    setBackfillResult(null);
    fetch('/api/backfill-predictions', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { setBackfillResult(d); load(); })
      .catch((e) => setBackfillResult({ error: e.message }))
      .finally(() => setBackfilling(false));
  };

  if (loading) {
    return <div className="text-text-dim text-sm p-8">Fetching scores and computing stats...</div>;
  }

  if (error) {
    return <div className="text-red-400 text-sm p-8">Error: {error}</div>;
  }

  const { stats, game_log } = data;

  // Build day options from all games
  const dayOptions = [...new Set(
    game_log.map((g) => g.commence_time ? new Date(g.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null).filter(Boolean)
  )].sort((a, b) => new Date(a) - new Date(b));

  const filterGames = (list) => list.filter((g) => {
    if (onlyValue && !g.value_bet_side) return false;
    if (dayFilter !== 'all') {
      const d = g.commence_time ? new Date(g.commence_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
      if (d !== dayFilter) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const home = (g.home_torvik || g.home_team || '').toLowerCase();
      const away = (g.away_torvik || g.away_team || '').toLowerCase();
      if (!home.includes(q) && !away.includes(q)) return false;
    }
    return true;
  });

  const completed = filterGames(game_log.filter((g) => g.completed));
  const pending = filterGames(game_log.filter((g) => !g.completed));

  return (
    <div className="space-y-6">
      {selectedGame && (
        <DetailPanel game={selectedGame} onClose={() => setSelectedGame(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-text-dim">Model Performance</h2>
        <div className="flex gap-2 items-center">
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="text-[10px] text-text-dim border border-border rounded px-2 py-1 hover:text-blue hover:border-blue transition-colors cursor-pointer disabled:opacity-50"
          >
            {backfilling ? 'Simulating...' : 'Simulate Historical'}
          </button>
          <button
            onClick={load}
            className="text-[10px] text-text-dim border border-border rounded px-2 py-1 hover:text-neon hover:border-neon transition-colors cursor-pointer"
          >
            Refresh Scores
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search team..."
          className="text-xs bg-surface border border-border rounded px-3 py-1.5 text-text placeholder-text-dim focus:outline-none focus:border-neon/50 w-36"
        />
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="text-xs bg-surface border border-border rounded px-3 py-1.5 text-text focus:outline-none focus:border-neon/50 cursor-pointer"
        >
          <option value="all">All Days</option>
          {dayOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button
          onClick={() => setOnlyValue((v) => !v)}
          className={`text-[10px] border rounded px-2 py-1.5 transition-colors cursor-pointer ${
            onlyValue ? 'border-neon text-neon bg-neon/10' : 'border-border text-text-dim hover:text-neon hover:border-neon'
          }`}
        >
          Value Bets Only
        </button>
      </div>

      {backfillResult && !backfillResult.error && (
        <div className="text-[10px] border border-border/40 rounded px-3 py-2 text-text-dim">
          Retroactive sim: <span className="text-neon">{backfillResult.retroactive_inserted} games inserted</span>
          {' '}/ {backfillResult.total_candidates} candidates
          {backfillResult.historical_spreads_found > 0 && (
            <span className="text-blue"> · {backfillResult.historical_spreads_found} historical lines fetched</span>
          )}
          {backfillResult.skipped_no_team_match > 0 && ` (${backfillResult.skipped_no_team_match} skipped — no team match)`}
        </div>
      )}
      {backfillResult?.error && (
        <div className="text-[10px] text-red-400">{backfillResult.error}</div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          label="Games Tracked"
          value={stats.games_completed + stats.games_pending}
          sub={`${stats.games_pending} pending`}
        />
        <StatCard
          label="MAE"
          value={stats.mae != null ? `${stats.mae} pts` : null}
          sub="mean abs error vs actual margin"
          color={stats.mae != null && stats.mae < 8 ? 'text-neon' : 'text-text'}
        />
        <StatCard
          label="RMSE"
          value={stats.rmse != null ? `${stats.rmse} pts` : null}
          sub="root mean squared error"
        />
        <StatCard
          label="Winner Accuracy"
          value={stats.winner_accuracy_pct != null ? `${stats.winner_accuracy_pct}%` : null}
          sub={`over ${stats.games_completed} completed games`}
          color={stats.winner_accuracy_pct >= 55 ? 'text-neon' : stats.winner_accuracy_pct < 50 ? 'text-red-400' : 'text-text'}
        />
        <StatCard
          label="Value Bet W/R"
          value={stats.value_bet_win_rate_pct != null ? `${stats.value_bet_win_rate_pct}%` : null}
          sub={`${stats.value_bet_wins ?? 0}/${stats.value_bets_completed} bets`}
          color={stats.value_bet_win_rate_pct >= 55 ? 'text-neon' : stats.value_bet_win_rate_pct < 50 ? 'text-red-400' : 'text-text'}
        />
      </div>

      {stats.bias != null && (
        <div className="text-[10px] text-text-dim border border-border/40 rounded px-3 py-2">
          Model bias: <span className={stats.bias > 0 ? 'text-neon' : 'text-blue'}>
            {stats.bias > 0 ? '+' : ''}{stats.bias} pts
          </span>
          {' '}({stats.bias > 0 ? 'slightly over-favoring home' : 'slightly over-favoring away'})
        </div>
      )}

      {/* Game log — completed */}
      {completed.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim mb-2">
            Completed Games <span className="normal-case text-text-dim/60">(click for detail)</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-left py-2 pr-4">Matchup</th>
                  <th className="text-right py-2 pr-4">Model</th>
                  <th className="text-right py-2 pr-4">Market</th>
                  <th className="text-right py-2 pr-4">Result</th>
                  <th className="text-right py-2 pr-4">Margin</th>
                  <th className="text-center py-2 pr-4">Pick</th>
                  <th className="text-center py-2">Value Bet</th>
                </tr>
              </thead>
              <tbody>
                {completed.map((g) => (
                  <tr
                    key={g.game_id}
                    onClick={() => setSelectedGame(g)}
                    className="border-b border-border/30 hover:bg-surface/50 cursor-pointer"
                  >
                    <td className="py-2 pr-4 text-text-dim whitespace-nowrap">{formatTime(g.commence_time)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <span className="text-text">{(g.away_torvik || g.away_team).replace(/ \w+$/, '')}</span>
                      <span className="text-text-dim"> @ </span>
                      <span className="text-text">{(g.home_torvik || g.home_team).replace(/ \w+$/, '')}</span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-blue">
                      {formatSpread(g.model_spread)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-dim">
                      {formatSpread(g.consensus_spread)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text">
                      {g.away_score}–{g.home_score}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      <span className={g.actual_margin > 0 ? 'text-neon' : 'text-blue'}>
                        {g.actual_margin > 0 ? `+${g.actual_margin}` : g.actual_margin}
                      </span>
                    </td>
                    <td className={`py-2 pr-4 text-center font-medium ${RESULT_STYLES[g.model_result] || 'text-text-dim'}`}>
                      {(() => {
                        const pickTeam = g.value_bet_side
                          ? (g.value_bet_side || '').replace(/ \w+$/, '')
                          : g.model_spread < 0
                            ? (g.home_torvik || g.home_team || '').replace(/ \w+$/, '')
                            : (g.away_torvik || g.away_team || '').replace(/ \w+$/, '');
                        return pickTeam || (g.model_result === 'correct' ? 'W' : 'L');
                      })()}
                    </td>
                    <td className="py-2 text-center">
                      {g.value_bet_side ? (
                        <span className={`font-medium ${VB_STYLES[g.value_bet_result] || 'text-text-dim'}`}>
                          {g.value_bet_result === 'won' ? 'W' : g.value_bet_result === 'lost' ? 'L' : '—'}
                          {' '}
                          <span className="text-text-dim font-normal">
                            {(g.value_bet_side || '').replace(/ \w+$/, '')}
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pending games */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-[10px] uppercase tracking-widest text-text-dim mb-2">
            Pending ({pending.length} games — results update automatically)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
                  <th className="text-left py-2 pr-4">Date</th>
                  <th className="text-left py-2 pr-4">Matchup</th>
                  <th className="text-right py-2 pr-4">Model</th>
                  <th className="text-right py-2 pr-4">Market</th>
                  <th className="text-right py-2 pr-4">Edge</th>
                  <th className="text-left py-2">Value Bet</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((g) => (
                  <tr
                    key={g.game_id}
                    onClick={() => setSelectedGame(g)}
                    className="border-b border-border/30 hover:bg-surface/50 cursor-pointer"
                  >
                    <td className="py-2 pr-4 text-text-dim whitespace-nowrap">{formatTime(g.commence_time)}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <span className="text-text">{(g.away_torvik || g.away_team).replace(/ \w+$/, '')}</span>
                      <span className="text-text-dim"> @ </span>
                      <span className="text-text">{(g.home_torvik || g.home_team).replace(/ \w+$/, '')}</span>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-blue">
                      {formatSpread(g.model_spread)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-dim">
                      {formatSpread(g.consensus_spread)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-dim">
                      {g.edge != null ? `${g.edge}` : '—'}
                    </td>
                    <td className="py-2 text-text-dim">
                      {g.value_bet_side
                        ? <span className="text-neon">{(g.value_bet_side || '').replace(/ \w+$/, '')}</span>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {game_log.length === 0 && (
        <div className="text-text-dim text-sm text-center py-12">
          No predictions tracked yet. Visit the Games tab to start tracking.
        </div>
      )}
    </div>
  );
}
