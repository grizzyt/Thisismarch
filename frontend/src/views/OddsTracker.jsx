import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fetchOdds, fetchPrediction } from '../api';

const BOOK_DISPLAY = {
  draftkings: 'DK',
  fanduel: 'FD',
  betmgm: 'MGM',
  williamhill_us: 'CZR',
  betrivers: 'BRiv',
  pointsbet: 'PBet',
};

const BOOK_COLORS = {
  draftkings: '#00ff87',
  fanduel: '#00b4ff',
  betmgm: '#ffaa00',
  williamhill_us: '#ff4444',
  betrivers: '#a855f7',
  pointsbet: '#f472b6',
};

function formatAmerican(price) {
  return price > 0 ? `+${price}` : `${price}`;
}

function LineMovementTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono">
      <div className="text-text-dim mb-1">{payload[0]?.payload?.time}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.dataKey}</span>
          <span className="text-text">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function OddsTracker({ teams }) {
  const [odds, setOdds] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [modelSpread, setModelSpread] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOdds()
      .then((data) => {
        setOdds(data);
        if (data.length > 0) setSelectedGame(data[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Fetch model prediction for the selected game
  useEffect(() => {
    if (!selectedGame || !teams) return;
    const home = selectedGame.home_team;
    const away = selectedGame.away_team;
    if (teams[home] && teams[away]) {
      fetchPrediction(home, away)
        .then((p) => setModelSpread(p.projected_spread))
        .catch(() => setModelSpread(null));
    } else {
      setModelSpread(null);
    }
  }, [selectedGame, teams]);

  // Parse odds data for the selected game
  const gameOdds = useMemo(() => {
    if (!selectedGame) return [];
    return selectedGame.bookmakers.map((bk) => {
      const spread = bk.markets.find((m) => m.key === 'spreads');
      const ml = bk.markets.find((m) => m.key === 'h2h');
      const total = bk.markets.find((m) => m.key === 'totals');
      return {
        book: bk.key,
        bookTitle: bk.title,
        homeSpread: spread?.outcomes.find((o) => o.name === selectedGame.home_team)?.point,
        homeSpreadPrice: spread?.outcomes.find((o) => o.name === selectedGame.home_team)?.price,
        awaySpread: spread?.outcomes.find((o) => o.name === selectedGame.away_team)?.point,
        awaySpreadPrice: spread?.outcomes.find((o) => o.name === selectedGame.away_team)?.price,
        homeML: ml?.outcomes.find((o) => o.name === selectedGame.home_team)?.price,
        awayML: ml?.outcomes.find((o) => o.name === selectedGame.away_team)?.price,
        overPoint: total?.outcomes.find((o) => o.name === 'Over')?.point,
        overPrice: total?.outcomes.find((o) => o.name === 'Over')?.price,
        underPrice: total?.outcomes.find((o) => o.name === 'Under')?.price,
      };
    });
  }, [selectedGame]);

  // Consensus spread (average)
  const consensus = useMemo(() => {
    if (!gameOdds.length) return null;
    const spreads = gameOdds.map((g) => g.homeSpread).filter(Boolean);
    return spreads.length ? spreads.reduce((a, b) => a + b, 0) / spreads.length : null;
  }, [gameOdds]);

  // Mock line movement data
  const lineMovement = useMemo(() => {
    if (!gameOdds.length) return [];
    const baseSpread = gameOdds[0]?.homeSpread || -5;
    const hours = ['Open', '-12h', '-8h', '-4h', '-2h', '-1h', 'Now'];
    return hours.map((time, i) => {
      const entry = { time };
      gameOdds.forEach((g) => {
        const drift = (Math.random() - 0.5) * 2;
        const progression = i / (hours.length - 1);
        entry[BOOK_DISPLAY[g.book] || g.book] =
          Math.round((baseSpread + drift * (1 - progression) + (g.homeSpread - baseSpread) * progression) * 2) / 2;
      });
      return entry;
    });
  }, [gameOdds]);

  // Value bet detection
  const modelEdge = modelSpread != null && consensus != null
    ? Math.abs(modelSpread - consensus)
    : null;
  const isValueBet = modelEdge != null && modelEdge >= 2;

  if (loading) {
    return <div className="text-center text-text-dim text-sm py-16">Loading odds...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Game Selector */}
      <div className="flex gap-2 flex-wrap">
        {odds.map((game) => (
          <button
            key={game.id}
            onClick={() => setSelectedGame(game)}
            className={`px-4 py-2 rounded text-xs font-mono cursor-pointer transition-colors ${
              selectedGame?.id === game.id
                ? 'bg-neon/20 text-neon border border-neon/40'
                : 'bg-surface border border-border text-text-dim hover:text-text'
            }`}
          >
            {game.away_team} @ {game.home_team}
          </button>
        ))}
      </div>

      {selectedGame && (
        <>
          {/* Model Edge Banner */}
          {modelEdge != null && (
            <div className={`border rounded-lg p-4 flex items-center justify-between ${
              isValueBet
                ? 'bg-neon/5 border-neon/30'
                : 'bg-surface border-border'
            }`}>
              <div>
                <div className="text-[10px] text-text-dim uppercase tracking-widest">
                  Model Edge Indicator
                </div>
                <div className="text-sm mt-1">
                  Model: <span className="text-neon">{modelSpread > 0 ? selectedGame.home_team : selectedGame.away_team} {Math.abs(modelSpread)}</span>
                  <span className="text-text-dim mx-2">|</span>
                  Consensus: <span className="text-blue">{consensus > 0 ? '' : '-'}{Math.abs(consensus).toFixed(1)}</span>
                  <span className="text-text-dim mx-2">|</span>
                  Diff: <span className={isValueBet ? 'text-neon' : 'text-text-dim'}>{modelEdge.toFixed(1)} pts</span>
                </div>
              </div>
              {isValueBet && (
                <div className="bg-neon/20 text-neon px-4 py-2 rounded text-xs font-bold uppercase tracking-wider animate-pulse">
                  Value Bet Detected
                </div>
              )}
            </div>
          )}

          {/* Odds Table */}
          <div className="bg-surface border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 px-4 text-left text-[10px] text-text-dim uppercase tracking-wider">Book</th>
                  <th className="py-3 px-3 text-center text-[10px] text-text-dim uppercase tracking-wider" colSpan={2}>
                    Spread
                  </th>
                  <th className="py-3 px-3 text-center text-[10px] text-text-dim uppercase tracking-wider" colSpan={2}>
                    Moneyline
                  </th>
                  <th className="py-3 px-3 text-center text-[10px] text-text-dim uppercase tracking-wider" colSpan={2}>
                    Total
                  </th>
                </tr>
                <tr className="border-b border-border/50">
                  <th />
                  <th className="py-1 px-3 text-center text-[9px] text-neon/70">{selectedGame.home_team}</th>
                  <th className="py-1 px-3 text-center text-[9px] text-blue/70">{selectedGame.away_team}</th>
                  <th className="py-1 px-3 text-center text-[9px] text-neon/70">{selectedGame.home_team}</th>
                  <th className="py-1 px-3 text-center text-[9px] text-blue/70">{selectedGame.away_team}</th>
                  <th className="py-1 px-3 text-center text-[9px] text-text-dim">Over</th>
                  <th className="py-1 px-3 text-center text-[9px] text-text-dim">Under</th>
                </tr>
              </thead>
              <tbody>
                {gameOdds.map((g) => (
                  <tr key={g.book} className="border-b border-border/30 hover:bg-surface-2/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: BOOK_COLORS[g.book] }} />
                        <span className="text-text">{g.bookTitle}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-neon">{g.homeSpread}</div>
                      <div className="text-text-dim text-[9px]">{formatAmerican(g.homeSpreadPrice)}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-blue">{g.awaySpread}</div>
                      <div className="text-text-dim text-[9px]">{formatAmerican(g.awaySpreadPrice)}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-neon">{formatAmerican(g.homeML)}</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-blue">{formatAmerican(g.awayML)}</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-text">{g.overPoint}</div>
                      <div className="text-text-dim text-[9px]">{formatAmerican(g.overPrice)}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="text-text">{g.overPoint}</div>
                      <div className="text-text-dim text-[9px]">{formatAmerican(g.underPrice)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Line Movement Chart */}
          <div className="bg-surface border border-border rounded-lg p-5">
            <h3 className="text-[10px] text-text-dim uppercase tracking-widest mb-4">
              Line Movement (Simulated)
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={lineMovement}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: '#888', fontSize: 9, fontFamily: 'Space Mono' }}
                />
                <YAxis
                  tick={{ fill: '#888', fontSize: 9 }}
                  domain={['dataMin - 1', 'dataMax + 1']}
                  width={40}
                />
                <Tooltip content={<LineMovementTooltip />} />
                {gameOdds.map((g) => {
                  const key = BOOK_DISPLAY[g.book] || g.book;
                  return (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={BOOK_COLORS[g.book]}
                      strokeWidth={1.5}
                      dot={{ r: 2, fill: BOOK_COLORS[g.book] }}
                      activeDot={{ r: 4 }}
                    />
                  );
                })}
                {modelSpread != null && (
                  <ReferenceLine
                    y={modelSpread}
                    stroke="#00ff87"
                    strokeDasharray="8 4"
                    strokeWidth={2}
                    label={{ value: 'Model', fill: '#00ff87', fontSize: 10, position: 'right' }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-4 mt-3 justify-center">
              {gameOdds.map((g) => (
                <div key={g.book} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-3 h-0.5 rounded" style={{ background: BOOK_COLORS[g.book] }} />
                  <span className="text-text-dim">{BOOK_DISPLAY[g.book]}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
