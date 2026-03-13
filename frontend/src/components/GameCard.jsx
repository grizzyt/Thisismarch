function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatSpread(val) {
  if (val == null) return '—';
  return val > 0 ? `+${val}` : `${val}`;
}

function formatAmerican(price) {
  if (price == null) return '';
  return price > 0 ? `+${price}` : `${price}`;
}

function getBestSpread(game, teamName) {
  let best = null;
  for (const bk of game.bookmakers || []) {
    for (const mkt of bk.markets || []) {
      if (mkt.key === 'spreads') {
        for (const o of mkt.outcomes) {
          if (o.name === teamName && o.point != null) {
            if (best === null || o.point < best.point) {
              best = { point: o.point, price: o.price, book: bk.title };
            }
          }
        }
      }
    }
  }
  return best;
}

function StatPill({ label, value, rank }) {
  return (
    <div className="text-center">
      <div className="text-[9px] text-text-dim uppercase tracking-wider">{label}</div>
      <div className="text-xs text-text tabular-nums">{value}</div>
      {rank && <div className="text-[8px] text-text-dim">#{rank}</div>}
    </div>
  );
}

export default function GameCard({ game, onClick }) {
  const { prediction, value_bet, home_stats, away_stats } = game;
  const p = prediction;
  const hasData = home_stats && away_stats && p;
  const started = game.commence_time && new Date(game.commence_time) <= new Date();

  return (
    <div
      onClick={onClick}
      className={`bg-surface border rounded-lg p-4 cursor-pointer transition-all hover:border-neon/50 ${
        value_bet && !started ? 'border-neon/40' : 'border-border'
      }`}
    >
      {/* Header: time + value badge */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-text-dim">
          {formatTime(game.commence_time)}
        </span>
        {value_bet && (
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
            started ? 'text-text-dim bg-border/20' : 'text-neon bg-neon/10'
          }`}>
            Value: {value_bet.side} +{value_bet.edge}pts
          </span>
        )}
      </div>

      {/* Matchup */}
      <div className="space-y-2 mb-3">
        {/* Away team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {away_stats && (
              <span className="text-[9px] text-text-dim w-5 text-right">#{away_stats.rank}</span>
            )}
            <span className={`text-sm ${p && p.away_win_pct > 50 ? 'text-blue font-bold' : 'text-text'}`}>
              {game.away_torvik || game.away_team.replace(/ \w+$/, '')}
            </span>
            {away_stats && (
              <span className="text-[10px] text-text-dim">{away_stats.record}</span>
            )}
          </div>
          {p && (
            <span className="text-xs text-text-dim tabular-nums">
              {formatSpread(p.consensus_spread != null ? -p.consensus_spread : null)}
            </span>
          )}
        </div>

        {/* Home team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {home_stats && (
              <span className="text-[9px] text-text-dim w-5 text-right">#{home_stats.rank}</span>
            )}
            <span className={`text-sm ${p && p.home_win_pct > 50 ? 'text-neon font-bold' : 'text-text'}`}>
              {game.home_torvik || game.home_team.replace(/ \w+$/, '')}
            </span>
            {home_stats && (
              <span className="text-[10px] text-text-dim">{home_stats.record}</span>
            )}
          </div>
          {p && (
            <span className="text-xs text-text-dim tabular-nums">
              {formatSpread(p.consensus_spread)}
            </span>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      {hasData && (
        <>
          {/* Win probability bar */}
          <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden flex mb-3">
            <div
              className="bg-neon/50 transition-all duration-300"
              style={{ width: `${p.home_win_pct}%` }}
            />
            <div
              className="bg-blue/50 transition-all duration-300"
              style={{ width: `${p.away_win_pct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] mb-3">
            <span className="text-neon">{p.home_win_pct}%</span>
            <span className="text-text-dim">Model Win Prob</span>
            <span className="text-blue">{p.away_win_pct}%</span>
          </div>

          {/* Model vs Market */}
          <div className="grid grid-cols-3 gap-2 text-center border-t border-border/50 pt-3">
            <div>
              <div className="text-[9px] text-text-dim uppercase">Model</div>
              <div className={`text-sm font-bold ${p.model_spread < 0 ? 'text-neon' : 'text-blue'}`}>
                {formatSpread(p.model_spread)}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-text-dim uppercase">Spread</div>
              <div className="text-sm text-text">
                {formatSpread(p.consensus_spread)}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-text-dim uppercase">Edge</div>
              <div className={`text-sm font-bold ${p.edge >= 2 ? 'text-neon' : 'text-text-dim'}`}>
                {p.edge != null ? `${p.edge}` : '—'}
              </div>
            </div>
          </div>

          {/* Total + Moneyline */}
          <div className="grid grid-cols-3 gap-2 text-center border-t border-border/50 pt-3">
            <div>
              <div className="text-[9px] text-text-dim uppercase">O/U</div>
              <div className="text-sm text-text tabular-nums">
                {game.consensus_total != null ? game.consensus_total : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-neon/70 uppercase">Home ML</div>
              <div className="text-sm text-neon tabular-nums">
                {game.home_ml != null ? formatAmerican(game.home_ml) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[9px] text-blue/70 uppercase">Away ML</div>
              <div className="text-sm text-blue tabular-nums">
                {game.away_ml != null ? formatAmerican(game.away_ml) : '—'}
              </div>
            </div>
          </div>

          {/* Stat comparison row */}
          <div className="grid grid-cols-2 gap-3 mt-3 border-t border-border/50 pt-3">
            <div>
              <div className="text-[9px] text-neon/70 uppercase tracking-wider mb-1">
                {game.home_torvik}
              </div>
              <div className="flex gap-2">
                <StatPill label="AdjOE" value={home_stats.adjOE} />
                <StatPill label="AdjDE" value={home_stats.adjDE} />
                <StatPill label="Tempo" value={home_stats.tempo} />
              </div>
            </div>
            <div>
              <div className="text-[9px] text-blue/70 uppercase tracking-wider mb-1">
                {game.away_torvik}
              </div>
              <div className="flex gap-2">
                <StatPill label="AdjOE" value={away_stats.adjOE} />
                <StatPill label="AdjDE" value={away_stats.adjDE} />
                <StatPill label="Tempo" value={away_stats.tempo} />
              </div>
            </div>
          </div>
        </>
      )}

      {!hasData && (
        <div className="text-[10px] text-text-dim text-center py-2 border-t border-border/50 mt-2">
          Team stats unavailable
        </div>
      )}
    </div>
  );
}
