import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { fetchPrediction } from '../api';
import TeamSelector from '../components/TeamSelector';

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

export default function SpreadModel({ teams }) {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!teamA || !teamB || teamA === teamB) {
      setPrediction(null);
      return;
    }
    setLoading(true);
    fetchPrediction(teamA, teamB)
      .then(setPrediction)
      .catch(() => setPrediction(null))
      .finally(() => setLoading(false));
  }, [teamA, teamB]);

  const factors = prediction?.factors;
  const mc = prediction?.monte_carlo;

  // Bin the distribution into wider buckets for cleaner viz
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

  // Mock market line for comparison
  const marketLine = prediction ? Math.round(prediction.projected_spread * 0.85 * 2) / 2 : 0;

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="grid grid-cols-2 gap-6">
        <TeamSelector teams={teams} value={teamA} onChange={setTeamA} label="Team A" />
        <TeamSelector teams={teams} value={teamB} onChange={setTeamB} label="Team B" />
      </div>

      {factors && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Factor Breakdown */}
          <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
            <h3 className="text-[10px] text-text-dim uppercase tracking-widest">
              Model Factor Breakdown
            </h3>
            <FactorBar label="Offensive Edge" value={factors.off_edge} />
            <FactorBar label="Defensive Edge" value={factors.def_edge} />
            <FactorBar label="SOS Adjustment" value={factors.sos_adj} maxAbs={5} />
            <FactorBar label="Luck Adjustment" value={factors.luck_adj} maxAbs={2} />

            <div className="pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="text-text-dim text-[10px] uppercase tracking-wider">
                  Avg Tempo
                </span>
                <span className="text-text text-sm">{factors.avg_tempo}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <div className="flex justify-between items-center">
                <span className="text-xs text-text-dim">Projected Spread</span>
                <span className={`text-lg font-bold ${prediction.projected_spread > 0 ? 'text-neon' : 'text-blue'}`}>
                  {prediction.projected_spread > 0 ? teamA : teamB} {Math.abs(prediction.projected_spread)}
                </span>
              </div>
            </div>
          </div>

          {/* Monte Carlo Distribution */}
          <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-5">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-[10px] text-text-dim uppercase tracking-widest">
                  Monte Carlo Simulation
                </h3>
                <p className="text-[10px] text-text-dim mt-1">
                  {mc?.simulations?.toLocaleString()} iterations — &sigma; = {mc?.std_dev}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-text-dim uppercase">Win Prob</div>
                <div className="text-sm">
                  <span className="text-neon">{teamA} {mc?.team_a_win_pct}%</span>
                  <span className="text-text-dim mx-1">/</span>
                  <span className="text-blue">{teamB} {mc?.team_b_win_pct}%</span>
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={distData} barCategoryGap={0}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis
                  dataKey="bin"
                  tick={{ fill: '#888', fontSize: 9, fontFamily: 'Space Mono' }}
                  label={{ value: `← ${teamB} favored | ${teamA} favored →`, position: 'bottom', offset: 0, fill: '#555', fontSize: 9, fontFamily: 'Space Mono' }}
                />
                <YAxis tick={{ fill: '#888', fontSize: 9 }} width={40} />
                <Tooltip content={<SimTooltip />} />
                <ReferenceLine x={0} stroke="#444" strokeDasharray="4 4" />
                <ReferenceLine
                  x={Math.round(prediction.projected_spread)}
                  stroke="#00ff87"
                  strokeWidth={2}
                  label={{ value: 'Model', fill: '#00ff87', fontSize: 10 }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {distData.map((entry) => (
                    <Cell
                      key={entry.bin}
                      fill={entry.bin >= 0 ? '#00ff8740' : '#00b4ff40'}
                      stroke={entry.bin >= 0 ? '#00ff87' : '#00b4ff'}
                      strokeWidth={0.5}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Spread Comparison */}
      {prediction && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-4">
            Projected Spread vs. Market Line
          </h3>
          <div className="grid grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Model Spread</div>
              <div className={`text-2xl font-bold ${prediction.projected_spread > 0 ? 'text-neon' : 'text-blue'}`}>
                {prediction.projected_spread > 0 ? '-' : '+'}{Math.abs(prediction.projected_spread)}
              </div>
              <div className="text-[10px] text-text-dim mt-1">
                {prediction.projected_spread > 0 ? teamA : teamB} favored
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Market Line</div>
              <div className="text-2xl font-bold text-yellow">
                {marketLine > 0 ? '-' : '+'}{Math.abs(marketLine)}
              </div>
              <div className="text-[10px] text-text-dim mt-1">
                Consensus (mock)
              </div>
            </div>
            <div className="text-center">
              <div className="text-[10px] text-text-dim uppercase tracking-wider mb-1">Edge</div>
              {(() => {
                const edge = Math.abs(prediction.projected_spread - marketLine);
                const hasEdge = edge >= 2;
                return (
                  <>
                    <div className={`text-2xl font-bold ${hasEdge ? 'text-neon' : 'text-text-dim'}`}>
                      {edge.toFixed(1)}
                    </div>
                    <div className={`text-[10px] mt-1 ${hasEdge ? 'text-neon' : 'text-text-dim'}`}>
                      {hasEdge ? 'VALUE BET' : 'No edge'}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center text-text-dim text-sm py-8">Running simulation...</div>
      )}

      {!teamA && !teamB && (
        <div className="text-center text-text-dim text-sm py-16">
          Select two teams to generate spread predictions
        </div>
      )}
    </div>
  );
}
