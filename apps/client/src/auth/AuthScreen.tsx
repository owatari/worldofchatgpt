import { useState, type FormEvent } from 'react';
import type { AuthResponse } from '@worldofchatgpt/shared';
import { login, register } from '../api';

interface Props { onAuthenticated: (response: AuthResponse) => void; }

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onAuthenticated(await (mode === 'login' ? login(username, password) : register(username, password)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen centered auth-bg">
      <section className="panel auth-panel">
        <div className="brand-mark">W</div>
        <p className="eyebrow">ENTER THE FRACTURE</p>
        <h1>World of ChatGPT</h1>
        <p className="muted">A browser-native online RPG prototype.</p>
        <div className="tabs">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={submit}>
          <label>Username<input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={24} required /></label>
          <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Connecting…' : mode === 'login' ? 'Enter World' : 'Create Account'}</button>
        </form>
      </section>
    </main>
  );
}
