import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL ?? '';

function Section({ step, title, children }) {
  return (
    <div className="border border-border rounded-lg p-4 mb-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] font-bold text-bg bg-neon rounded px-1.5 py-0.5">{step}</span>
        <span className="text-sm font-bold text-text uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, highlight, mono }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border/30 last:border-0">
      <span className="text-xs text-text-dim">{label}</span>
      <span className={`text-xs font-bold tabular-nums ${highlight || 'text-text'} ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function FormulaLine({ label, formula, result, highlight }) {
  return (
    <div className="py-1.5 border-b border-border/20 last:border-0">
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="text-[10px] text-text-dim uppercase tracking-wider">{label}</div>
          <div className="text-[11px] text-text-dim font-mono mt-0.5">{formula}</div>
        </div>
        <div className={`text-sm font-bold tabular-nums shrink-0 ${highlight || 'text-text'}`}>{result}</div>
      </div>
    </div>
  );
}

function WinBar({ homePct, home, away }) {
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[10px] text-text-dim mb-1">
        <span>{home}</span>
        <span>{away}</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden">
        <div className="bg-neon/70" style={{ width: `${homePct}%` }} />
        <div className="bg-blue/50 flex-1" />
      </div>
      <div className="flex justify-between text-[11px] font-bold mt-1">
        <span className="text-neon">{homePct}%</span>
        <span className="text-blue">{(100 - homePct).toFixed(1)}%</span>
      </div>
    </div>
  );
}

function formatSpread(val) {
  if (val == null) return '—';
  return val > 0 ? `+${val}` : `${val}`;
}

function GameBreakdown({ game }) {
  const { prediction: p, home_stats, away_stats, value_bet } = game;
  const home = game.home_torvik || game.home_team;
  const away = game.away_torvik || game.away_team;
  const f = p?.factors;
  const mc = p?.monte_carlo;

  if (!p || !home_stats || !away_stats || !f) {
    return (
      <div className="text-text-dim text-xs text-center py-6">
        Not enough data for this game to show a breakdown.
      </div>
    );
  }

  const modelFavorsHome = p.model_spread < 0;
  const marketFavorsHome = p.consensus_spread != null && p.consensus_spread < 0;
  const modelFavoredTeam = modelFavorsHome ? home : away;
  const edgeExists = p.edge != null && p.edge >= 2 && p.edge <= 8;

  // The formula uses internal convention (positive = home favored)
  // model_spread in the API is already market convention (negative = home fav)
  // factors.spread is internal convention
  const internalSpread = f.spread; // positive = home favored

  return (
    <div className="mt-4 space-y-3">

      {/* Step 1: Team Data */}
      <Section step="1" title="Pull BartTorvik Efficiency Data">
        <p className="text-[11px] text-text-dim mb-3">
          BartTorvik adjusts each team's offensive and defensive efficiency for pace and strength of schedule. These are the foundation of every projection.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-neon uppercase tracking-wider mb-2">{home} (Home)</div>
            <Row label="AdjOE" value={home_stats.adjOE} />
            <Row label="AdjDE" value={home_stats.adjDE} />
            <Row label="Tempo" value={home_stats.tempo} />
            <Row label="Rank" value={`#${home_stats.rank}`} />
          </div>
          <div>
            <div className="text-[10px] text-blue uppercase tracking-wider mb-2">{away} (Away)</div>
            <Row label="AdjOE" value={away_stats.adjOE} />
            <Row label="AdjDE" value={away_stats.adjDE} />
            <Row label="Tempo" value={away_stats.tempo} />
            <Row label="Rank" value={`#${away_stats.rank}`} />
          </div>
        </div>
        <div className="mt-3 text-[11px] bg-surface-2 rounded p-2 text-text-dim">
          <span className="text-text font-bold">National avg OE used:</span> {f.nat_avg} pts/100 — the D1 mean efficiency this season, recomputed every 10 min from live Torvik data.
        </div>
      </Section>

      {/* Step 2: Matchup Projections */}
      <Section step="2" title="Project Expected Efficiency Per Team">
        <p className="text-[11px] text-text-dim mb-3">
          Each team's adjusted offense is run against the opponent's adjusted defense, normalized by the national average. This accounts for matchup quality rather than raw ratings.
        </p>
        <div className="bg-surface-2 rounded p-3 mb-3 space-y-0">
          <FormulaLine
            label={`${home} expected OE`}
            formula={`${home_stats.adjOE} × ${away_stats.adjDE} ÷ ${f.nat_avg}`}
            result={f.home_exp_oe}
            highlight="text-neon"
          />
          <FormulaLine
            label={`${away} expected OE`}
            formula={`${away_stats.adjOE} × ${home_stats.adjDE} ÷ ${f.nat_avg}`}
            result={f.away_exp_oe}
            highlight="text-blue"
          />
          <FormulaLine
            label="Avg tempo (possessions)"
            formula={`(${home_stats.tempo} + ${away_stats.tempo}) ÷ 2`}
            result={f.avg_tempo}
          />
        </div>
        <div className="text-[11px] text-text-dim">
          Expected OE above/below {f.nat_avg} predicts which team scores more per possession.
        </div>
      </Section>

      {/* Step 3: Compute Raw Spread */}
      <Section step="3" title="Calculate the Raw Spread">
        <p className="text-[11px] text-text-dim mb-3">
          The raw margin is derived from the efficiency gap scaled by tempo. Then home court advantage is added, and a shrinkage factor (0.80) compresses toward zero — models that are overconfident lose money.
        </p>
        <div className="bg-surface-2 rounded p-3 mb-3 space-y-0">
          <FormulaLine
            label="Raw margin"
            formula={`(${f.home_exp_oe} − ${f.away_exp_oe}) ÷ 100 × ${f.avg_tempo}`}
            result={`${f.raw_spread > 0 ? '+' : ''}${f.raw_spread}`}
          />
          <FormulaLine
            label="Home court advantage"
            formula={f.hca > 0 ? `+${f.hca} pts (home game)` : 'None (neutral site)'}
            result={f.hca > 0 ? `+${f.hca}` : '0'}
          />
          <FormulaLine
            label="Pre-calibration"
            formula={`${f.raw_spread > 0 ? '+' : ''}${f.raw_spread} + ${f.hca}`}
            result={`${(f.raw_spread + f.hca) > 0 ? '+' : ''}${(f.raw_spread + f.hca).toFixed(1)}`}
          />
          <FormulaLine
            label="Shrinkage × 0.80"
            formula={`${(f.raw_spread + f.hca).toFixed(1)} × 0.80  (regression to mean)`}
            result={`${internalSpread > 0 ? '+' : ''}${internalSpread}`}
            highlight={internalSpread >= 0 ? 'text-neon' : 'text-blue'}
          />
        </div>
        <div className="text-[11px] bg-surface-2 rounded p-2 text-text-dim">
          Model projects <span className="text-text font-bold">{modelFavoredTeam}</span> to win by{' '}
          <span className="text-neon font-bold">{Math.abs(internalSpread)} pts</span>.{' '}
          Market convention: <span className="font-bold text-text">{formatSpread(p.model_spread)}</span>.
        </div>
      </Section>

      {/* Step 4: Monte Carlo simulation */}
      {mc && (
        <Section step="4" title="Monte Carlo Simulation (10,000 Games)">
          <p className="text-[11px] text-text-dim mb-3">
            The model runs 10,000 simulated games, varying tempo and efficiency game-to-game. This captures the natural variance of college basketball and produces a win probability distribution.
          </p>
          <Row label="Simulated games" value={mc.simulations?.toLocaleString()} />
          <Row label="Mean spread" value={`${mc.mean_spread > 0 ? '+' : ''}${mc.mean_spread}`} />
          <Row
            label="Std deviation"
            value={`±${mc.std_dev} pts`}
            highlight="text-text-dim"
          />
          <div className="text-[11px] text-text-dim mt-2 bg-surface-2 rounded p-2">
            ±{mc.std_dev} pts std dev means the actual margin could reasonably land anywhere from{' '}
            <span className="text-text font-bold">{(mc.mean_spread - mc.std_dev).toFixed(1)}</span> to{' '}
            <span className="text-text font-bold">{(mc.mean_spread + mc.std_dev).toFixed(1)}</span>.
          </div>
          <WinBar homePct={mc.home_win_pct} home={home} away={away} />
        </Section>
      )}

      {/* Step 5: Market Comparison */}
      <Section step="5" title="Compare to Vegas Consensus">
        <p className="text-[11px] text-text-dim mb-3">
          The consensus spread is averaged across DraftKings, FanDuel, BetMGM, BetRivers, and others, then rounded to the nearest 0.5. The model and market are then blended (65% model / 35% market).
        </p>
        <Row label="Model spread" value={formatSpread(p.model_spread)} highlight={modelFavorsHome ? 'text-neon' : 'text-blue'} />
        <Row label="Vegas consensus" value={formatSpread(p.consensus_spread)} highlight={marketFavorsHome ? 'text-neon' : 'text-blue'} />
        {p.consensus_spread != null && (
          <Row
            label="Blended line (65/35)"
            value={formatSpread(f.blended_spread)}
            highlight="text-text-dim"
          />
        )}
        <Row
          label="Raw edge (model vs market)"
          value={p.edge != null ? `${p.edge} pts` : '—'}
          highlight={edgeExists ? 'text-neon' : 'text-text-dim'}
        />
      </Section>

      {/* Step 6: Value Bet Decision */}
      <Section step="6" title="Value Bet Decision">
        <p className="text-[11px] text-text-dim mb-3">
          A value bet is flagged when the edge is between 2 and 8 points. Under 2 is noise. Over 8 may indicate bad data or sharp line movement we haven't captured.
        </p>
        <Row label="Edge threshold" value="2.0 – 8.0 pts" />
        <Row
          label="This game's edge"
          value={p.edge != null ? `${p.edge} pts` : '—'}
          highlight={edgeExists ? 'text-neon' : 'text-text-dim'}
        />
        <Row
          label="Value bet flagged?"
          value={value_bet ? 'YES' : 'NO'}
          highlight={value_bet ? 'text-neon' : 'text-text-dim'}
        />

        {value_bet ? (
          <div className="mt-3 text-[11px] bg-neon/10 border border-neon/30 rounded p-3">
            <div className="text-neon font-bold mb-1">✓ Value Bet: {value_bet.side}</div>
            <div className="text-text-dim">
              The model projects <span className="text-text font-bold">{value_bet.side}</span> to
              cover the <span className="text-text font-bold">{formatSpread(p.consensus_spread)}</span> Vegas spread
              by <span className="text-neon font-bold">{value_bet.edge} pts</span> more than the
              market expects.
            </div>
          </div>
        ) : (
          <div className="mt-3 text-[11px] bg-border/20 border border-border rounded p-3 text-text-dim">
            {p.edge == null
              ? 'No edge calculated — missing market spread data.'
              : p.edge < 2
              ? `Edge of ${p.edge} pts is below the 2pt threshold. The model and market agree closely — no clear advantage.`
              : `Edge of ${p.edge} pts exceeds the 8pt cap. This likely indicates bad data or a major line move not yet reflected.`}
          </div>
        )}
      </Section>
    </div>
  );
}

function OUBreakdown({ ou, cal, stats }) {
  if (!ou) return (
    <div className="text-text-dim text-xs text-center py-4 border border-border/30 rounded">
      No O/U model data for this game.
    </div>
  );

  const isValue = ou.ou_value;
  const edgeColor = ou.ou_pick === 'over' ? 'text-neon' : 'text-blue';
  const slope = cal?.slope ?? 1.074;
  const intercept = cal?.intercept ?? -12.5;
  const calLabel = intercept < 0
    ? `${slope} × raw − ${Math.abs(intercept)}`
    : `${slope} × raw + ${intercept}`;
  const nGames = stats?.games_completed ?? '—';

  return (
    <div className="mt-4 space-y-3">
      <Section step="A" title="O/U — Predict the Total Score">
        <p className="text-[11px] text-text-dim mb-3">
          Using the same efficiency data as the spread model, the O/U model predicts how many total points will be scored. Both teams' expected offense is summed and scaled by pace.
        </p>
        <div className="bg-surface-2 rounded p-3 mb-3 space-y-0">
          <FormulaLine
            label="Home expected OE"
            formula={`home_adjOE × away_adjDE ÷ nat_avg`}
            result={ou.home_exp_oe}
            highlight="text-neon"
          />
          <FormulaLine
            label="Away expected OE"
            formula={`away_adjOE × home_adjDE ÷ nat_avg`}
            result={ou.away_exp_oe}
            highlight="text-blue"
          />
          <FormulaLine
            label="Avg tempo"
            formula={`(home_tempo + away_tempo) ÷ 2`}
            result={`${ou.avg_tempo} poss`}
          />
          <FormulaLine
            label="Raw total"
            formula={`(${ou.home_exp_oe} + ${ou.away_exp_oe}) ÷ 100 × ${ou.avg_tempo}`}
            result={ou.raw_total}
          />
          <FormulaLine
            label="Calibrated model total"
            formula={`${calLabel}  (fitted to ${nGames} games)`}
            result={<span className="text-neon font-bold">{ou.model_total}</span>}
            highlight="text-neon"
          />
        </div>
      </Section>

      <Section step="B" title="O/U — Compare to Market Line">
        <p className="text-[11px] text-text-dim mb-3">
          The market O/U line is the consensus total from major sportsbooks. The edge is how far the model deviates from that line. A value bet is flagged when the edge is 2–10 pts.
        </p>
        <Row label="Model total" value={ou.model_total} highlight="text-neon" />
        <Row label="Market O/U" value={ou.consensus_total ?? '—'} />
        <Row
          label="Edge"
          value={ou.ou_edge != null ? `${ou.ou_edge > 0 ? '+' : ''}${ou.ou_edge} pts` : '—'}
          highlight={Math.abs(ou.ou_edge ?? 0) >= 2 ? edgeColor : 'text-text-dim'}
        />
        <Row
          label="Pick"
          value={ou.ou_pick ? ou.ou_pick.toUpperCase() : '—'}
          highlight={ou.ou_pick === 'over' ? 'text-neon' : 'text-blue'}
        />
        <Row
          label="Value bet?"
          value={isValue ? 'YES' : 'NO'}
          highlight={isValue ? 'text-neon' : 'text-text-dim'}
        />
        {isValue && (
          <div className="mt-3 text-[11px] bg-neon/10 border border-neon/30 rounded p-3">
            <div className={`font-bold mb-1 ${edgeColor}`}>
              ✓ O/U Value: {ou.ou_pick?.toUpperCase()} {ou.consensus_total}
            </div>
            <div className="text-text-dim">
              Model projects total of <span className="text-neon font-bold">{ou.model_total}</span>,
              market sits at <span className="text-text font-bold">{ou.consensus_total}</span>.
              Edge of <span className={`font-bold ${edgeColor}`}>{Math.abs(ou.ou_edge)} pts</span> — take the {ou.ou_pick}.
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

export default function TheBrain({ games }) {
  const [selectedId, setSelectedId] = useState('');
  const [ouGames, setOuGames] = useState([]);
  const [ouCal, setOuCal] = useState(null);
  const [ouStats, setOuStats] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/ou-games`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.games) setOuGames(d.games); if (d?.calibration) setOuCal(d.calibration); })
      .catch(() => {});
    fetch(`${API}/api/ou-performance`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.stats) setOuStats(d.stats); })
      .catch(() => {});
  }, []);

  const selectedGame = games?.find((g) => g.id === selectedId);
  const selectedOU = ouGames.find((g) => g.id === selectedId);
  const gamesWithData = games?.filter((g) => g.prediction && g.home_stats && g.away_stats) || [];

  return (
    <div className="max-w-2xl mx-auto">

      {/* Static explanation */}
      <div className="mb-8">
        <h2 className="text-neon text-lg font-bold tracking-tight mb-1">The Brain</h2>
        <p className="text-text-dim text-xs mb-4">How ThisIsMarch finds value bets</p>

        <div className="space-y-2 text-[11px] text-text-dim leading-relaxed border border-border rounded-lg p-4">
          <p><span className="text-text font-bold">Step 1 — Team Efficiency Data:</span> Pull adjusted offensive and defensive efficiency ratings from BartTorvik for both teams. These account for pace and strength of schedule.</p>
          <p><span className="text-text font-bold">Step 2 — Matchup Projections:</span> Run each team's adjusted offense against the opponent's adjusted defense, normalized by the D1 national average. This tells us how efficient each team will be in this specific matchup.</p>
          <p><span className="text-text font-bold">Step 3 — Raw Spread:</span> Multiply the efficiency gap by average tempo (possessions per game) to get expected scoring margin. Add home court advantage if applicable, then compress by 0.80 to account for regression to the mean.</p>
          <p><span className="text-text font-bold">Step 4 — Monte Carlo:</span> Run 10,000 simulations varying tempo and per-possession efficiency to generate a win probability distribution.</p>
          <p><span className="text-text font-bold">Step 5 — Market Consensus:</span> Average the spread from all major sportsbooks. Blend with the model (65% model / 35% market) for the final projected line.</p>
          <p><span className="text-text font-bold">Step 6 — Find the Edge:</span> If the model and market disagree by 2–8 pts, that's a credible value bet. Under 2 is noise. Over 8 may be bad data.</p>
          <p><span className="text-text font-bold">Step 7 — Lock at Tipoff:</span> Once a game starts, the spread is frozen to the pre-game line so live movement doesn't distort results.</p>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <div className="text-[10px] text-text-dim uppercase tracking-widest mb-2 font-bold">Over/Under Model</div>
          <div className="space-y-2 text-[11px] text-text-dim leading-relaxed border border-border rounded-lg p-4">
            <p><span className="text-text font-bold">Step A — Predict the Total:</span> Using the same BartTorvik efficiency data, each team's offense is run against the opponent's defense:</p>
            <div className="font-mono text-text bg-surface-2 rounded px-3 py-2 space-y-1 text-[10px]">
              <div>home_exp_oe = home_adjOE × away_adjDE ÷ nat_avg</div>
              <div>away_exp_oe = away_adjOE × home_adjDE ÷ nat_avg</div>
              <div>raw_total = (home_exp_oe + away_exp_oe) ÷ 100 × avg_tempo</div>
            </div>
            <p><span className="text-text font-bold">Calibration:</span> A linear correction fitted to historical game totals via least-squares regression. Current fit ({ouStats?.games_completed ?? '—'} games):{' '}
              <span className="font-mono text-text">
                {ouCal
                  ? `${ouCal.slope} × raw ${ouCal.intercept < 0 ? '−' : '+'} ${Math.abs(ouCal.intercept)}`
                  : '1.074 × raw − 12.5'}
              </span>.
            </p>
            <p><span className="text-text font-bold">Step B — Find the Edge:</span> If the model total deviates from the market O/U line by 2–10 pts, a value bet is flagged. Over 2 suggests real disagreement with the market. Over 10 may indicate a data issue.</p>
            <p><span className="text-text font-bold">Performance:</span>{' '}
              {ouStats
                ? <><span className="text-text font-bold">{ouStats.value_win_rate_pct ?? '—'}%</span> win rate on value bets ({ouStats.value_wins}/{ouStats.value_completed})</>
                : '—'
              }{' '}across completed games. NCAA tournament results are the true out-of-sample test.
            </p>
          </div>
        </div>
      </div>

      {/* Game analyzer */}
      <div>
        <h3 className="text-sm font-bold text-text uppercase tracking-wider mb-3">Analyze a Game</h3>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full bg-surface border border-border rounded px-3 py-2 text-xs text-text focus:outline-none focus:border-neon transition-colors"
        >
          <option value="">Select a game...</option>
          {gamesWithData.map((g) => {
            const home = g.home_torvik || g.home_team;
            const away = g.away_torvik || g.away_team;
            const label = `${away} @ ${home}${g.value_bet ? ' ★ Value' : ''}`;
            return <option key={g.id} value={g.id}>{label}</option>;
          })}
        </select>

        {selectedGame && (
          <>
            <GameBreakdown game={selectedGame} />
            <div className="mt-6 border-t border-border pt-4">
              <div className="text-[10px] text-text-dim uppercase tracking-widest mb-3 font-bold">Over/Under Breakdown</div>
              <OUBreakdown ou={selectedOU} cal={ouCal} stats={ouStats} />
            </div>
          </>
        )}

        {!selectedGame && (
          <div className="text-center text-text-dim text-xs py-10 border border-border/30 rounded-lg mt-4">
            Select a game above to see the full model breakdown — formula by formula.
          </div>
        )}
      </div>
    </div>
  );
}
