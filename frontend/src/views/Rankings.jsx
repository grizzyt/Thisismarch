import { useState, useEffect, useCallback } from 'react';

const API = '';

const COLS = [
  { key: 'rank',    label: 'Rk',      title: 'Rank',                    num: true },
  { key: 'team',    label: 'Team',     title: 'Team',                    num: false },
  { key: 'conf',    label: 'Conf',     title: 'Conference',              num: false },
  { key: 'record',  label: 'Record',   title: 'W-L Record',              num: false },
  { key: 'adjOE',   label: 'AdjOE',   title: 'Adjusted Offensive Efficiency (pts/100 poss)', num: true },
  { key: 'adjDE',   label: 'AdjDE',   title: 'Adjusted Defensive Efficiency (pts/100 poss)', num: true },
  { key: 'adjEM',   label: 'AdjEM',   title: 'Adjusted Efficiency Margin (OE - DE)',          num: true },
  { key: 'barthag', label: 'Barthag', title: 'Power Rating (win prob vs avg D1)',             num: true },
  { key: 'tempo',   label: 'Tempo',   title: 'Adjusted Tempo (possessions/game)',             num: true },
  { key: 'sos',     label: 'SOS',     title: 'Strength of Schedule',                         num: true },
  { key: 'luck',    label: 'Luck',    title: 'Luck Rating',                                  num: true },
  { key: 'seed',    label: 'Seed',    title: 'Tournament Seed',                              num: true },
];

function SortIcon({ dir }) {
  if (!dir) return <span className="text-text-dim/30 ml-1">↕</span>;
  return <span className="text-neon ml-1">{dir === 'asc' ? '↑' : '↓'}</span>;
}

function UnmappedTeams({ torvik_teams }) {
  const [unmatched, setUnmatched] = useState([]);
  const [selections, setSelections] = useState({});
  const [saving, setSaving] = useState({});
  const [saved, setSaved] = useState({});

  useEffect(() => {
    fetch(`${API}/api/unmatched-teams`)
      .then(r => r.json())
      .then(d => setUnmatched(d.unmatched || []));
  }, []);

  const saveMapping = async (oddsName) => {
    const torvik = selections[oddsName];
    if (!torvik) return;
    setSaving(s => ({ ...s, [oddsName]: true }));
    await fetch(`${API}/api/team-alias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ odds_name: oddsName, torvik_name: torvik }),
    });
    setSaving(s => ({ ...s, [oddsName]: false }));
    setSaved(s => ({ ...s, [oddsName]: true }));
    setUnmatched(u => u.filter(n => n !== oddsName));
  };

  if (unmatched.length === 0) return null;

  return (
    <div className="mb-6 border border-yellow/30 rounded bg-yellow/5 p-4">
      <div className="text-yellow text-xs font-bold uppercase tracking-wider mb-3">
        {unmatched.length} Unmapped Team{unmatched.length > 1 ? 's' : ''} — assign to BartTorvik
      </div>
      <div className="space-y-2">
        {unmatched.map(name => (
          <div key={name} className="flex items-center gap-3 flex-wrap">
            <span className="text-text text-xs w-64 shrink-0">{name}</span>
            <span className="text-text-dim text-xs">→</span>
            <select
              value={selections[name] || ''}
              onChange={e => setSelections(s => ({ ...s, [name]: e.target.value }))}
              className="bg-bg border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-neon flex-1 min-w-48 max-w-72"
            >
              <option value="">Select BartTorvik team...</option>
              {torvik_teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button
              onClick={() => saveMapping(name)}
              disabled={!selections[name] || saving[name]}
              className="text-xs border rounded px-3 py-1 transition-colors cursor-pointer disabled:opacity-40 border-neon text-neon hover:bg-neon/10"
            >
              {saving[name] ? 'Saving...' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Rankings() {
  const [teams, setTeams] = useState([]);
  const [torvik_teams, setTorvik_teams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');
  const [search, setSearch] = useState('');
  const [confFilter, setConfFilter] = useState('');

  useEffect(() => {
    fetch(`${API}/api/teams`)
      .then(r => r.json())
      .then(d => {
        setTeams(d.teams);
        setTorvik_teams(d.teams.map(t => t.team).sort());
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'adjDE' ? 'asc' : (COLS.find(c => c.key === key)?.num ? 'desc' : 'asc'));
    }
  };

  const confs = [...new Set(teams.map(t => t.conf).filter(Boolean))].sort();

  const sorted = [...teams]
    .filter(t => {
      if (search && !t.team.toLowerCase().includes(search.toLowerCase())) return false;
      if (confFilter && t.conf !== confFilter) return false;
      return true;
    })
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const col = COLS.find(c => c.key === sortKey);
      if (col?.num) return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });

  if (loading) return <div className="text-text-dim text-sm p-8">Loading rankings...</div>;
  if (error) return <div className="text-red text-sm p-8">Error: {error}</div>;

  return (
    <div className="space-y-4">
      <UnmappedTeams torvik_teams={torvik_teams} />
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search team..."
          className="bg-transparent border border-border rounded px-3 py-1.5 text-xs text-text placeholder-text-dim focus:outline-none focus:border-neon transition-colors w-44"
        />
        <select
          value={confFilter}
          onChange={e => setConfFilter(e.target.value)}
          className="bg-bg border border-border rounded px-3 py-1.5 text-xs text-text focus:outline-none focus:border-neon transition-colors"
        >
          <option value="">All Conferences</option>
          {confs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-text-dim text-xs">{sorted.length} teams</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface/50">
              {COLS.map(col => (
                <th
                  key={col.key}
                  title={col.title}
                  onClick={() => handleSort(col.key)}
                  className={`px-3 py-2 whitespace-nowrap cursor-pointer hover:text-neon transition-colors select-none ${
                    col.num ? 'text-right' : 'text-left'
                  } ${sortKey === col.key ? 'text-neon' : 'text-text-dim'}`}
                >
                  {col.label}
                  <SortIcon dir={sortKey === col.key ? sortDir : null} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr
                key={t.team}
                className={`border-b border-border/40 hover:bg-surface/30 transition-colors ${
                  i % 2 === 0 ? '' : 'bg-surface/10'
                }`}
              >
                <td className="px-3 py-1.5 text-right text-text-dim tabular-nums">{t.rank ?? '—'}</td>
                <td className="px-3 py-1.5 text-left text-text font-medium whitespace-nowrap">{t.team}</td>
                <td className="px-3 py-1.5 text-left text-text-dim">{t.conf ?? '—'}</td>
                <td className="px-3 py-1.5 text-left text-text-dim tabular-nums">{t.record ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-neon/80">{t.adjOE?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red/80">{t.adjDE?.toFixed(1) ?? '—'}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                  t.adjEM > 0 ? 'text-neon' : t.adjEM < 0 ? 'text-red/80' : 'text-text-dim'
                }`}>{t.adjEM != null ? (t.adjEM > 0 ? '+' : '') + t.adjEM.toFixed(1) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-text">{t.barthag?.toFixed(4) ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-text-dim">{t.tempo?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-text-dim">{t.sos?.toFixed(3) ?? '—'}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${
                  t.luck > 0 ? 'text-neon/70' : t.luck < 0 ? 'text-red/70' : 'text-text-dim'
                }`}>{t.luck != null ? (t.luck > 0 ? '+' : '') + t.luck.toFixed(3) : '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-blue/80">{t.seed ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
