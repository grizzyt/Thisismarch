import { useState, useEffect } from 'react';
import { fetchGames } from './api';
import GameList from './views/GameList';
import GameDetail from './views/GameDetail';
import Performance from './views/Performance';
import Rankings from './views/Rankings';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'value'
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('time'); // 'time' | 'value'
  const [hideStarted, setHideStarted] = useState(false);
  const [onlyValue, setOnlyValue] = useState(false);
  const [onlyToday, setOnlyToday] = useState(false);

  const load = () => {
    setLoading(true);
    fetchGames()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Auto-refresh every 2 min
  useEffect(() => {
    const id = setInterval(load, 120000);
    return () => clearInterval(id);
  }, []);

  const games = data?.games || [];
  const valueBets = games.filter((g) => g.value_bet);

  const filterGames = (list) => {
    let result = list;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((g) =>
        g.home_team.toLowerCase().includes(q) ||
        g.away_team.toLowerCase().includes(q) ||
        (g.home_torvik || '').toLowerCase().includes(q) ||
        (g.away_torvik || '').toLowerCase().includes(q)
      );
    }
    if (hideStarted) {
      result = result.filter((g) => new Date(g.commence_time) > new Date());
    }
    if (onlyValue) {
      result = result.filter((g) => g.value_bet);
    }
    if (onlyToday) {
      const today = new Date().toLocaleDateString();
      result = result.filter((g) => new Date(g.commence_time).toLocaleDateString() === today);
    }
    if (sort === 'time') {
      result = [...result].sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
    } else if (sort === 'value') {
      result = [...result].sort((a, b) => (b.value_bet?.edge ?? -Infinity) - (a.value_bet?.edge ?? -Infinity));
    }
    return result;
  };

  return (
    <div className="min-h-screen bg-bg font-mono">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-neon text-xl font-bold tracking-tight">
            MADNESS<span className="text-blue">LAB</span>
          </div>
          <span className="text-text-dim text-xs tracking-widest uppercase hidden sm:inline">
            NCAAB Betting Analytics
          </span>
        </div>
        <div className="flex items-center gap-4">
          {data && (
            <span className="text-[10px] text-text-dim uppercase tracking-wider">
              {data.source === 'live' ? (
                <span className="text-neon">● LIVE</span>
              ) : (
                <span className="text-yellow">● MOCK</span>
              )}
              {' '}{games.length} games
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="text-[10px] text-text-dim border border-border rounded px-2 py-1 hover:text-neon hover:border-neon transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Filter bar */}
      <nav className="border-b border-border px-6 flex items-center justify-between gap-4">
        <div className="flex gap-1 shrink-0">
          {[
            { id: 'all', label: `All Games (${games.length})` },
            { id: 'value', label: `Value Bets (${valueBets.length})` },
            { id: 'performance', label: 'Performance' },
            { id: 'rankings', label: 'Rankings' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => { setFilter(f.id); setSelectedGame(null); }}
              className={`px-4 py-3 text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                filter === f.id
                  ? 'text-neon border-b-2 border-neon'
                  : 'text-text-dim hover:text-text border-b-2 border-transparent'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {!selectedGame && filter !== 'performance' && filter !== 'rankings' && (
          <div className="flex items-center gap-2">
            <div className="flex text-[10px] border border-border rounded overflow-hidden">
              {[{ id: 'time', label: 'Time' }, { id: 'value', label: 'Edge' }].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={`px-2 py-1 transition-colors cursor-pointer ${
                    sort === s.id ? 'bg-border/40 text-text' : 'text-text-dim hover:text-text'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setHideStarted((v) => !v)}
              className={`text-[10px] border rounded px-2 py-1 transition-colors cursor-pointer ${
                hideStarted ? 'text-neon border-neon' : 'text-text-dim border-border hover:text-text'
              }`}
            >
              Hide Started
            </button>
            <button
              onClick={() => setOnlyValue((v) => !v)}
              className={`text-[10px] border rounded px-2 py-1 transition-colors cursor-pointer ${
                onlyValue ? 'text-neon border-neon' : 'text-text-dim border-border hover:text-text'
              }`}
            >
              Value Bets
            </button>
            <button
              onClick={() => setOnlyToday((v) => !v)}
              className={`text-[10px] border rounded px-2 py-1 transition-colors cursor-pointer ${
                onlyToday ? 'text-neon border-neon' : 'text-text-dim border-border hover:text-text'
              }`}
            >
              Today
            </button>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team..."
              className="bg-transparent border border-border rounded px-3 py-1 text-xs text-text placeholder-text-dim focus:outline-none focus:border-neon transition-colors w-44"
            />
          </div>
        )}

        {selectedGame && (
          <button
            onClick={() => setSelectedGame(null)}
            className="text-xs text-text-dim hover:text-neon cursor-pointer transition-colors"
          >
            ← Back to list
          </button>
        )}
      </nav>

      {/* Content */}
      <main className="p-6">
        {error && (
          <div className="bg-red/10 border border-red/30 text-red px-4 py-3 rounded text-sm mb-4">
            Backend unavailable: {error}
          </div>
        )}

        {selectedGame ? (
          <GameDetail game={selectedGame} onBack={() => setSelectedGame(null)} />
        ) : filter === 'performance' ? (
          <Performance />
        ) : filter === 'rankings' ? (
          <Rankings />
        ) : (
          <GameList
            games={filterGames(filter === 'value' ? valueBets : games)}
            loading={loading}
            onSelect={setSelectedGame}
          />
        )}
      </main>
    </div>
  );
}
