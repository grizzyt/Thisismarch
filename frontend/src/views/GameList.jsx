import GameCard from '../components/GameCard';

export default function GameList({ games, loading, onSelect }) {
  if (loading && !games.length) {
    return (
      <div className="text-center text-text-dim text-sm py-16">
        Loading games...
      </div>
    );
  }

  if (!games.length) {
    return (
      <div className="text-center text-text-dim text-sm py-16">
        No games available right now. Check back during game days.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {games.map((game) => (
        <GameCard key={game.id} game={game} onClick={() => onSelect(game)} />
      ))}
    </div>
  );
}
