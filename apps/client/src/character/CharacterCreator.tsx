import { useState } from 'react';
import { CLASS_DEFINITIONS } from '@worldofchatgpt/game-core';
import type { CharacterSummary, ClassId } from '@worldofchatgpt/shared';
import { createCharacter } from '../api';

interface Props { token: string; onCreated: (character: CharacterSummary) => void; }
const classOrder: ClassId[] = ['warrior', 'mage', 'cleric'];

export function CharacterCreator({ token, onCreated }: Props) {
  const [name, setName] = useState('');
  const [classId, setClassId] = useState<ClassId>('mage');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError('');
    try { onCreated(await createCharacter(token, name, classId)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create character.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="screen create-bg">
      <section className="creator">
        <p className="eyebrow">NEW ADVENTURER</p><h1>Create Character</h1>
        <label className="name-field">Character Name<input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={24} placeholder="Choose a name" /></label>
        <div className="class-grid">
          {classOrder.map((id) => {
            const c = CLASS_DEFINITIONS[id];
            return <button key={id} className={`class-card ${classId === id ? 'selected' : ''}`} onClick={() => setClassId(id)}>
              <span className={`class-icon ${id}`}>{id === 'warrior' ? '⚔' : id === 'mage' ? '✦' : '✚'}</span>
              <strong>{c.name}</strong><small>{c.description}</small>
              <div className="skill-list"><span>{c.abilities[0].name}</span><span>{c.abilities[1].name}</span></div>
            </button>;
          })}
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary create-button" disabled={busy || name.trim().length < 3} onClick={() => void create()}>{busy ? 'Creating…' : `Begin as ${CLASS_DEFINITIONS[classId].name}`}</button>
      </section>
    </main>
  );
}
