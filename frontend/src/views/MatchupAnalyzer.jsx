import { useState, useEffect } from 'react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Legend,
} from 'recharts';
import { fetchPrediction } from '../api';
import TeamSelector from '../components/TeamSelector';

const STAT_LABELS = {
  adjOE: 'Adj. Off Eff',
  adjDE: 'Adj. Def Eff',
  tempo: 'Tempo',
  sos: 'SOS',
};

function normalize(val, min, max) {
  return Math.round(((val - min) / (max - min)) * 100);
}

const RANGES = {
  adjOE: [95, 125],
  adjDE: [85, 100],
  tempo: [60, 75],
  sos: [1, 10],
};

function StatRow({ label, valA, valB, better }) {
  return (
    <tr className="border-b border-border/50">
      <td className={`py-2 px-3 text-right text-sm tabular-nums ${better === 'a' ? 'text-neon' : 'text-text'}`}>
        {valA}
      </td>
      <td className="py-2 px-4 text-center text-[10px] text-text-dim uppercase tracking-wider">
        {label}
      </td>
      <td className={`py-2 px-3 text-left text-sm tabular-nums ${better === 'b' ? 'text-blue' : 'text-text'}`}>
        {valB}
      </td>
    </tr>
  );
}

export default function MatchupAnalyzer({ teams }) {
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

  const a = teams?.[teamA];
  const b = teams?.[teamB];

  const radarData = a && b
    ? Object.keys(STAT_LABELS).map((key) => {
        const [min, max] = RANGES[key];
        return {
          stat: STAT_LABELS[key],
          [teamA]: normalize(key === 'adjDE' ? (max + min - a[key]) : a[key], min, max),
          [teamB]: normalize(key === 'adjDE' ? (max + min - b[key]) : b[key], min, max),
        };
      })
    : [];

  const winProb = prediction?.win_probability;

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="grid grid-cols-2 gap-6">
        <TeamSelector teams={teams} value={teamA} onChange={setTeamA} label="Team A" />
        <TeamSelector teams={teams} value={teamB} onChange={setTeamB} label="Team B" />
      </div>

      {/* Win Probability Banner */}
      {winProb && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="flex h-12 relative">
            <div
              className="bg-neon/20 flex items-center justify-end pr-3 transition-all duration-500"
              style={{ width: `${winProb.team_a}%` }}
            >
              <span className="text-neon text-sm font-bold">{winProb.team_a}%</span>
            </div>
            <div
              className="bg-blue/20 flex items-center pl-3 transition-all duration-500"
              style={{ width: `${winProb.team_b}%` }}
            >
              <span className="text-blue text-sm font-bold">{winProb.team_b}%</span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] text-text-dim uppercase tracking-widest bg-bg/80 px-3 py-1 rounded">
                Win Probability
              </span>
            </div>
          </div>
          <div className="flex justify-between px-4 py-2 text-xs text-text-dim">
            <span className="text-neon">{teamA}{a ? ` (${a.seed})` : ''}</span>
            {prediction && (
              <span>
                Proj. Spread: <span className={prediction.projected_spread > 0 ? 'text-neon' : 'text-blue'}>
                  {prediction.projected_spread > 0 ? `${teamA} -${Math.abs(prediction.projected_spread)}` : `${teamB} -${Math.abs(prediction.projected_spread)}`}
                </span>
              </span>
            )}
            <span className="text-blue">{teamB}{b ? ` (${b.seed})` : ''}</span>
          </div>
        </div>
      )}

      {a && b && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Stat Comparison Table */}
          <div className="bg-surface border border-border rounded-lg p-4">
            <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-4">
              Side-by-Side Comparison
            </h3>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 px-3 text-right text-[10px] text-neon uppercase tracking-wider">{teamA}</th>
                  <th className="py-2 px-4 text-center text-[10px] text-text-dim uppercase tracking-wider">Stat</th>
                  <th className="py-2 px-3 text-left text-[10px] text-blue uppercase tracking-wider">{teamB}</th>
                </tr>
              </thead>
              <tbody>
                <StatRow label="Adj. Off Eff" valA={a.adjOE} valB={b.adjOE} better={a.adjOE > b.adjOE ? 'a' : 'b'} />
                <StatRow label="Adj. Def Eff" valA={a.adjDE} valB={b.adjDE} better={a.adjDE < b.adjDE ? 'a' : 'b'} />
                <StatRow label="Tempo" valA={a.tempo} valB={b.tempo} better={null} />
                <StatRow label="SOS" valA={a.sos} valB={b.sos} better={a.sos > b.sos ? 'a' : 'b'} />
                <StatRow label="Luck" valA={a.luck.toFixed(3)} valB={b.luck.toFixed(3)} better={null} />
                <StatRow label="KenPom Rtg" valA={(a.adjOE - a.adjDE).toFixed(1)} valB={(b.adjOE - b.adjDE).toFixed(1)}
                  better={(a.adjOE - a.adjDE) > (b.adjOE - b.adjDE) ? 'a' : 'b'} />
                <StatRow label="Conf" valA={a.conf} valB={b.conf} better={null} />
                <StatRow label="Record" valA={a.record} valB={b.record} better={null} />
                <StatRow label="Seed" valA={a.seed} valB={b.seed} better={a.seed < b.seed ? 'a' : 'b'} />
              </tbody>
            </table>
          </div>

          {/* Radar Chart */}
          <div className="bg-surface border border-border rounded-lg p-4">
            <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-4">
              Radar Overlay
            </h3>
            <ResponsiveContainer width="100%" height={350}>
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="#2a2a2a" />
                <PolarAngleAxis
                  dataKey="stat"
                  tick={{ fill: '#888', fontSize: 10, fontFamily: 'Space Mono' }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={false}
                  axisLine={false}
                />
                <Radar
                  name={teamA}
                  dataKey={teamA}
                  stroke="#00ff87"
                  fill="#00ff87"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Radar
                  name={teamB}
                  dataKey={teamB}
                  stroke="#00b4ff"
                  fill="#00b4ff"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'Space Mono' }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center text-text-dim text-sm py-8">
          Loading prediction...
        </div>
      )}

      {!teamA && !teamB && (
        <div className="text-center text-text-dim text-sm py-16">
          Select two teams to analyze their matchup
        </div>
      )}
    </div>
  );
}
