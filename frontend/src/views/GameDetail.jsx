import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine,
} from 'recharts';

function formatSpread(val) {
  if (val == null) return '—';
  return val > 0 ? `+${val}` : `${val}`;
}

function formatAmerican(price) {
  if (price == null) return '';
  return price > 0 ? `+${price}` : `${price}`;
}

function normalize(val, min, max) {
  return Math.round(((val - min) / (max - min)) * 100);
}

const RANGES = { adjOE: [95, 135], adjDE: [85, 115], tempo: [58, 78], sos: [0, 15] };

function FactorBar({ label, value, maxAbs = 15 }) {
  const pct = Math.min(Math.abs(value) / maxAbs * 100, 100);
  const isPositive = value >= 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] uppercase tracking-wider">
        <span className="text-text-dim">{label}</span>
        <span className={isPositive ? 'text-neon' : 'text-red'}>
          {value > 0 ? '+' : ''}{value.toFixed(2)}
        </span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden relative">
        <div className="absolute inset-0 flex">
          <div className="w-1/2" />
          <div className="w-px bg-border h-full" />
          <div className="w-1/2" />
        </div>
        {isPositive ? (
          <div
            className="h-full bg-neon/60 rounded-full transition-all duration-500"
            style={{ marginLeft: '50%', width: `${pct / 2}%` }}
          />
        ) : (
          <div
            className="h-full bg-red/60 rounded-full transition-all duration-500 ml-auto"
            style={{ marginRight: '50%', width: `${pct / 2}%` }}
          />
        )}
      </div>
    </div>
  );
}

function SimTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono">
      <div className="text-text-dim">Spread: {payload[0].payload.bin}</div>
      <div className="text-neon">Count: {payload[0].value}</div>
    </div>
  );
}

function StatRow({ label, valA, valB, better }) {
  return (
    <tr className="border-b border-border/30">
      <td className={`py-1.5 px-3 text-right text-xs tabular-nums ${better === 'a' ? 'text-neon' : 'text-text'}`}>
        {valA}
      </td>
      <td className="py-1.5 px-3 text-center text-[9px] text-text-dim uppercase tracking-wider">{label}</td>
      <td className={`py-1.5 px-3 text-left text-xs tabular-nums ${better === 'b' ? 'text-blue' : 'text-text'}`}>
        {valB}
      </td>
    </tr>
  );
}

export default function GameDetail({ game, onBack }) {
  const { prediction: p, value_bet, home_stats: h, away_stats: a } = game;
  const homeName = game.home_torvik || game.home_team;
  const awayName = game.away_torvik || game.away_team;

  if (!h || !a || !p) {
    return (
      <div className="text-center text-text-dim py-16">
        <p>Stats unavailable for this matchup.</p>
        <button onClick={onBack} className="text-neon mt-4 cursor-pointer">← Back</button>
      </div>
    );
  }

  const factors = p.factors;
  const mc = p.monte_carlo;

  // Radar data
  const radarData = ['adjOE', 'adjDE', 'tempo', 'sos'].map((key) => {
    const [min, max] = RANGES[key];
    return {
      stat: key === 'adjOE' ? 'Offense' : key === 'adjDE' ? 'Defense' : key === 'tempo' ? 'Tempo' : 'SOS',
      [homeName]: normalize(key === 'adjDE' ? (max + min - h[key]) : h[key], min, max),
      [awayName]: normalize(key === 'adjDE' ? (max + min - a[key]) : a[key], min, max),
    };
  });

  // Monte Carlo distribution (bucketed)
  const distData = mc?.distribution
    ? (() => {
        const buckets = {};
        mc.distribution.forEach(({ bin, count }) => {
          const key = Math.round(bin / 2) * 2;
          buckets[key] = (buckets[key] || 0) + count;
        });
        return Object.entries(buckets)
          .map(([bin, count]) => ({ bin: Number(bin), count }))
          .sort((a, b) => a.bin - b.bin);
      })()
    : [];

  // Odds table
  const oddsRows = (game.bookmakers || []).map((bk) => {
    const spread = bk.markets?.find((m) => m.key === 'spreads');
    const ml = bk.markets?.find((m) => m.key === 'h2h');
    const total = bk.markets?.find((m) => m.key === 'totals');
    return {
      book: bk.title,
      homeSpread: spread?.outcomes?.find((o) => o.name === game.home_team)?.point,
      homeSpreadPrice: spread?.outcomes?.find((o) => o.name === game.home_team)?.price,
      awaySpread: spread?.outcomes?.find((o) => o.name === game.away_team)?.point,
      awaySpreadPrice: spread?.outcomes?.find((o) => o.name === game.away_team)?.price,
      homeML: ml?.outcomes?.find((o) => o.name === game.home_team)?.price,
      awayML: ml?.outcomes?.find((o) => o.name === game.away_team)?.price,
      overPt: total?.outcomes?.find((o) => o.name === 'Over')?.point,
      overPrice: total?.outcomes?.find((o) => o.name === 'Over')?.price,
      underPrice: total?.outcomes?.find((o) => o.name === 'Under')?.price,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header banner */}
      <div className={`border rounded-lg p-5 ${value_bet ? 'bg-neon/5 border-neon/30' : 'bg-surface border-border'}`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 text-lg">
              <span className="text-blue font-bold">{awayName}</span>
              <span className="text-text-dim text-sm">@</span>
              <span className="text-neon font-bold">{homeName}</span>
            </div>
            <div className="text-[10px] text-text-dim mt-1">
              {new Date(game.commence_time).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
              })}
              {h.conf && ` · ${h.conf} vs ${a.conf}`}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-[9px] text-text-dim uppercase">Model</div>
              <div className={`text-xl font-bold ${p.model_spread < 0 ? 'text-neon' : 'text-blue'}`}>
                {formatSpread(p.model_spread)}
              </div>
            </div>
            {p.blended_spread != null && (
              <div className="text-center">
                <div className="text-[9px] text-text-dim uppercase">Blended</div>
                <div className="text-xl text-text">{formatSpread(p.blended_spread)}</div>
              </div>
            )}
            <div className="text-center">
              <div className="text-[9px] text-text-dim uppercase">Market</div>
              <div className="text-xl text-text">{formatSpread(p.consensus_spread)}</div>
            </div>
            {value_bet && (
              <div className="bg-neon/20 text-neon px-4 py-2 rounded text-xs font-bold uppercase tracking-wider">
                BET {value_bet.side} (+{value_bet.edge}pts edge)
              </div>
            )}
          </div>
        </div>

        {/* Win prob bar */}
        <div className="mt-4">
          <div className="flex h-3 rounded-full overflow-hidden">
            <div className="bg-neon/40 transition-all" style={{ width: `${p.home_win_pct}%` }} />
            <div className="bg-blue/40 transition-all" style={{ width: `${p.away_win_pct}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px]">
            <span className="text-neon">{homeName} {p.home_win_pct}%</span>
            <span className="text-blue">{awayName} {p.away_win_pct}%</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Stat comparison table */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-3">Stat Comparison</h3>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 px-3 text-right text-[9px] text-neon uppercase">{homeName}</th>
                <th className="py-1.5 px-3 text-center text-[9px] text-text-dim uppercase">Stat</th>
                <th className="py-1.5 px-3 text-left text-[9px] text-blue uppercase">{awayName}</th>
              </tr>
            </thead>
            <tbody>
              <StatRow label="Rank" valA={`#${h.rank}`} valB={`#${a.rank}`} better={h.rank < a.rank ? 'a' : 'b'} />
              <StatRow label="Record" valA={h.record} valB={a.record} better={null} />
              <StatRow label="AdjOE" valA={h.adjOE} valB={a.adjOE} better={h.adjOE > a.adjOE ? 'a' : 'b'} />
              <StatRow label="AdjDE" valA={h.adjDE} valB={a.adjDE} better={h.adjDE < a.adjDE ? 'a' : 'b'} />
              <StatRow label="Barthag" valA={h.barthag} valB={a.barthag} better={h.barthag > a.barthag ? 'a' : 'b'} />
              <StatRow label="Tempo" valA={h.tempo} valB={a.tempo} better={null} />
              <StatRow label="SOS" valA={h.sos} valB={a.sos} better={h.sos > a.sos ? 'a' : 'b'} />
              <StatRow label="Luck" valA={h.luck} valB={a.luck} better={null} />
              <StatRow label="Conf" valA={h.conf} valB={a.conf} better={null} />
            </tbody>
          </table>
        </div>

        {/* Radar Chart */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-3">Radar Overlay</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="#2a2a2a" />
              <PolarAngleAxis dataKey="stat" tick={{ fill: '#888', fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name={homeName} dataKey={homeName} stroke="#00ff87" fill="#00ff87" fillOpacity={0.15} strokeWidth={2} />
              <Radar name={awayName} dataKey={awayName} stroke="#00b4ff" fill="#00b4ff" fillOpacity={0.15} strokeWidth={2} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Factor breakdown */}
        <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
          <h3 className="text-[10px] text-text-dim uppercase tracking-widest">Model Breakdown</h3>

          {/* Projected efficiencies */}
          <div className="grid grid-cols-2 gap-2 text-center bg-surface-2/50 rounded p-2">
            <div>
              <div className="text-[9px] text-neon/70 uppercase mb-0.5">Home ExpOE</div>
              <div className="text-sm tabular-nums text-neon font-bold">{factors.home_exp_oe}</div>
              <div className="text-[8px] text-text-dim">pts/100 vs this defense</div>
            </div>
            <div>
              <div className="text-[9px] text-blue/70 uppercase mb-0.5">Away ExpOE</div>
              <div className="text-sm tabular-nums text-blue font-bold">{factors.away_exp_oe}</div>
              <div className="text-[8px] text-text-dim">pts/100 vs this defense</div>
            </div>
          </div>

          <FactorBar
            label="Efficiency Edge (home)"
            value={parseFloat((factors.home_exp_oe - factors.away_exp_oe).toFixed(2))}
            maxAbs={20}
          />
          {factors.hca > 0 && (
            <FactorBar label="Home Court" value={factors.hca} maxAbs={5} />
          )}

          <div className="pt-2 border-t border-border/50 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Raw Spread</span>
              <span className="text-text tabular-nums">
                {factors.raw_spread > 0 ? '+' : ''}{factors.raw_spread}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Model (×{(0.80).toFixed(2)} shrink)</span>
              <span className={`tabular-nums font-bold ${factors.spread >= 0 ? 'text-neon' : 'text-blue'}`}>
                {factors.spread > 0 ? '+' : ''}{factors.spread}
              </span>
            </div>
            {factors.blended_spread != null && (
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Blended (65% model / 35% market)</span>
                <span className="text-text tabular-nums">{formatSpread(factors.blended_spread)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs border-t border-border/30 pt-1.5 mt-1">
              <span className="text-text-dim">Avg Tempo</span>
              <span className="text-text tabular-nums">{factors.avg_tempo}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Nat Avg OE</span>
              <span className="text-text tabular-nums">{factors.nat_avg}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Monte Carlo + Odds Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monte Carlo */}
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-[10px] text-text-dim uppercase tracking-widest">Monte Carlo Simulation</h3>
              <p className="text-[10px] text-text-dim mt-1">
                {mc?.simulations?.toLocaleString()} iterations · σ = {mc?.std_dev}
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={distData} barCategoryGap={0}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
              <XAxis
                dataKey="bin"
                tick={{ fill: '#888', fontSize: 9 }}
                label={{ value: `← ${awayName} | ${homeName} →`, position: 'bottom', offset: 0, fill: '#555', fontSize: 9 }}
              />
              <YAxis tick={{ fill: '#888', fontSize: 9 }} width={35} />
              <Tooltip content={<SimTooltip />} />
              <ReferenceLine x={0} stroke="#444" strokeDasharray="4 4" />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {distData.map((entry) => (
                  <Cell
                    key={entry.bin}
                    fill={entry.bin <= 0 ? '#00ff8740' : '#00b4ff40'}
                    stroke={entry.bin <= 0 ? '#00ff87' : '#00b4ff'}
                    strokeWidth={0.5}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Odds table */}
        <div className="bg-surface border border-border rounded-lg overflow-x-auto">
          <div className="p-4 pb-2">
            <h3 className="text-[10px] text-text-dim uppercase tracking-widest">Sportsbook Lines</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-3 text-left text-[9px] text-text-dim uppercase">Book</th>
                <th className="py-2 px-2 text-center text-[9px] text-neon/70" colSpan={2}>Spread</th>
                <th className="py-2 px-2 text-center text-[9px] text-text-dim" colSpan={2}>ML</th>
                <th className="py-2 px-2 text-center text-[9px] text-text-dim">Total</th>
              </tr>
            </thead>
            <tbody>
              {oddsRows.map((r) => (
                <tr key={r.book} className="border-b border-border/30 hover:bg-surface-2/50">
                  <td className="py-2 px-3 text-text">{r.book}</td>
                  <td className="py-2 px-2 text-center">
                    <span className="text-neon">{formatSpread(r.homeSpread)}</span>
                    <span className="text-text-dim text-[9px] ml-1">{formatAmerican(r.homeSpreadPrice)}</span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className="text-blue">{formatSpread(r.awaySpread)}</span>
                    <span className="text-text-dim text-[9px] ml-1">{formatAmerican(r.awaySpreadPrice)}</span>
                  </td>
                  <td className="py-2 px-2 text-center text-neon">{formatAmerican(r.homeML)}</td>
                  <td className="py-2 px-2 text-center text-blue">{formatAmerican(r.awayML)}</td>
                  <td className="py-2 px-2 text-center text-text">
                    {r.overPt && (
                      <>
                        {r.overPt}
                        <span className="text-text-dim text-[9px] ml-1">
                          o{formatAmerican(r.overPrice)} u{formatAmerican(r.underPrice)}
                        </span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
