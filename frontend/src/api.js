const BASE = '/api';

export async function fetchGames() {
  const res = await fetch(`${BASE}/games`);
  if (!res.ok) throw new Error('Failed to fetch games');
  return res.json();
}

export async function fetchTeams() {
  const res = await fetch(`${BASE}/teams`);
  if (!res.ok) throw new Error('Failed to fetch teams');
  return res.json();
}

export async function fetchPrediction(teamA, teamB) {
  const params = new URLSearchParams({ team_a: teamA, team_b: teamB });
  const res = await fetch(`${BASE}/predict?${params}`);
  if (!res.ok) throw new Error('Failed to fetch prediction');
  return res.json();
}

export async function fetchPerformance() {
  const res = await fetch(`${BASE}/performance`);
  if (!res.ok) throw new Error('Failed to fetch performance');
  return res.json();
}
