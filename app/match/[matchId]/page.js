import GameClient from './game-client';

export default async function MatchPage({ params }) { const { matchId } = await params; return <GameClient matchId={matchId} />; }
