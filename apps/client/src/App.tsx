import { useEffect, useState } from 'react';
import type { AuthResponse, CharacterSummary } from '@worldofchatgpt/shared';
import { AuthScreen } from './auth/AuthScreen';
import { CharacterCreator } from './character/CharacterCreator';
import { GameView } from './game/GameView';
import { getMe } from './api';

const TOKEN_KEY = 'worldofchatgpt_token';

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [character, setCharacter] = useState<CharacterSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(token));

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    void getMe(token).then(setCharacter).catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); }).finally(() => setLoading(false));
  }, [token]);

  const authenticated = (response: AuthResponse) => { localStorage.setItem(TOKEN_KEY,response.token);setToken(response.token);setCharacter(response.character); };
  const logout = () => { localStorage.removeItem(TOKEN_KEY);setToken(null);setCharacter(null); };

  if (loading) return <main className="screen centered auth-bg"><div className="loading-mark">W</div></main>;
  if (!token) return <AuthScreen onAuthenticated={authenticated}/>;
  if (!character) return <CharacterCreator token={token} onCreated={setCharacter}/>;
  return <GameView token={token} character={character} onLogout={logout}/>;
}
