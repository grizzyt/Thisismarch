export default function TeamSelector({ teams, value, onChange, label }) {
  const teamList = teams ? Object.values(teams) : [];
  const sorted = [...teamList].sort((a, b) => a.seed - b.seed || a.team.localeCompare(b.team));

  return (
    <div className="flex flex-col gap-1">
      <label className="text-text-dim text-[10px] uppercase tracking-widest">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface border border-border rounded px-3 py-2 text-sm text-text font-mono focus:border-neon focus:outline-none appearance-none cursor-pointer"
      >
        <option value="">Select team...</option>
        {sorted.map((t) => (
          <option key={t.team} value={t.team}>
            ({t.seed}) {t.team} — {t.record}
          </option>
        ))}
      </select>
    </div>
  );
}
