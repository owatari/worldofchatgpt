import { useEffect, useRef, useState } from 'react';
import type { AbilityHudState, CharacterSummary, MonsterSnapshot, PlayerSnapshot, ServerMessage } from '@worldofchatgpt/shared';
import { xpForNextLevel } from '@worldofchatgpt/game-core';
import { GameEngine } from './engine/GameEngine';
import { GameSocket } from './networking/GameSocket';

interface Props { token: string; character: CharacterSummary; onLogout: () => void; }
interface WorldUi { self: PlayerSnapshot; monster: MonsterSnapshot; abilities: AbilityHudState[]; targetId: string | null; serverTime: number; }

export function GameView({ token, character, onLogout }: Props) {
  const mountRef = useRef<HTMLDivElement>(null); const engineRef = useRef<GameEngine | null>(null); const socketRef = useRef<GameSocket | null>(null);
  const [world, setWorld] = useState<WorldUi | null>(null); const [status, setStatus] = useState('Connecting…'); const [toast, setToast] = useState('');
  const latest = useRef<WorldUi | null>(null);

  const handleMessage = (message: ServerMessage, engine: GameEngine) => {
    if (message.type === 'error') { setToast(message.message); window.setTimeout(() => setToast(''), 1800); return; }
    if (message.type === 'combat') { engine.combat(message.event); return; }
    const next: WorldUi = message.type === 'welcome'
      ? { self: message.self, monster: message.monster, abilities: message.abilities, targetId: message.selectedTargetId, serverTime: Date.now() }
      : { self: message.self, monster: message.monster, abilities: message.abilities, targetId: message.selectedTargetId, serverTime: message.serverTime };
    latest.current = next; setWorld(next);
    engine.setSnapshot({ self: message.self, players: message.type === 'state' ? message.players : [], monster: message.monster, selectedTargetId: message.selectedTargetId });
  };

  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const castBasicAt = (targetId: string) => {
      const current = latest.current; const basic = current?.abilities[0]; if (!basic) return;
      socketRef.current?.send({ type: 'target', targetId }); socketRef.current?.send({ type: 'cast', abilityId: basic.id, targetId });
    };
    const engine = new GameEngine(mount, castBasicAt); engineRef.current = engine;
    const socket = new GameSocket(token, (message) => handleMessage(message, engine), setStatus); socketRef.current = socket; socket.connect();
    return () => { socket.send({ type: 'move', x: 0, z: 0 }); socket.close(); engine.destroy(); socketRef.current=null; engineRef.current=null; };
  }, [token]);

  useEffect(() => {
    const down = new Set<string>();
    const sendMovement = () => { let x=0,z=0;if(down.has('KeyA'))x-=1;if(down.has('KeyD'))x+=1;if(down.has('KeyW'))z-=1;if(down.has('KeyS'))z+=1;socketRef.current?.send({type:'move',x,z}); };
    const keyDown=(e:KeyboardEvent)=>{
      if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)){down.add(e.code);sendMovement();e.preventDefault();}
      if(e.code==='Tab'){const current=latest.current;if(current && !current.monster.dead){const targetId=current.targetId===current.monster.entityId?null:current.monster.entityId;socketRef.current?.send({type:'target',targetId});e.preventDefault();}}
      if(['Digit1','Digit2','Digit3'].includes(e.code)){const index=Number(e.code.slice(-1))-1;const ability=latest.current?.abilities[index];if(ability)socketRef.current?.send({type:'cast',abilityId:ability.id,targetId:latest.current?.targetId ?? null});e.preventDefault();}
    };
    const keyUp=(e:KeyboardEvent)=>{if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)){down.delete(e.code);sendMovement();}};
    const blur=()=>socketRef.current?.send({type:'move',x:0,z:0});
    window.addEventListener('keydown',keyDown);window.addEventListener('keyup',keyUp);window.addEventListener('blur',blur);
    return()=>{window.removeEventListener('keydown',keyDown);window.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);};
  },[]);

  const cast = (ability: AbilityHudState) => socketRef.current?.send({ type:'cast', abilityId: ability.id, targetId: world?.targetId ?? null });
  const now = world?.serverTime ?? Date.now();
  const hpPct = world ? (world.self.hp/world.self.maxHp)*100 : 0;
  const targetVisible = world ? world.targetId === world.monster.entityId && !world.monster.dead : false;

  return <main className="game-shell">
    <div className="game-canvas" ref={mountRef}/>
    <div className="connection">● {status}</div>
    <section className="player-hud glass"><div><strong>{world?.self.name ?? character.name}</strong><span>{(world?.self.classId ?? character.classId).toUpperCase()} · LV {world?.self.level ?? character.level}</span></div><div className="bar hp"><i style={{width:`${hpPct}%`}}/></div><small>{world?.self.hp ?? '—'} / {world?.self.maxHp ?? '—'} HP</small><div className="xp-line">XP {world?.self.xp ?? character.xp} / {xpForNextLevel(world?.self.level ?? character.level)}</div></section>
    {world && targetVisible && <section className="target-hud glass"><strong>{world.monster.name}</strong><div className="bar enemy"><i style={{width:`${(world.monster.hp/world.monster.maxHp)*100}%`}}/></div><small>{world.monster.hp} / {world.monster.maxHp}</small></section>}
    <button className="logout glass" onClick={onLogout}>Logout</button>
    <div className="hint glass">WASD Move · Click/Tab Target · 1 Basic · 2–3 Skills</div>
    <section className="hotbar">{(world?.abilities ?? []).map((a,i)=>{const remaining=Math.max(0,a.readyAt-now);const pct=a.cooldownMs?remaining/a.cooldownMs:0;return <button key={a.id} onClick={()=>cast(a)} disabled={remaining>0 || Boolean(world?.self.dead)}><span className="key">{i+1}</span><b>{a.name}</b>{remaining>0&&<span className="cooldown" style={{height:`${pct*100}%`}}/>}<em>{remaining>0?(remaining/1000).toFixed(1):''}</em></button>;})}</section>
    {toast && <div className="toast">{toast}</div>}
    {world?.self.dead && <div className="death-overlay"><h2>YOU DIED</h2><p>The Training Slime wins this round.</p><button className="primary" onClick={()=>socketRef.current?.send({type:'respawn'})}>Respawn</button></div>}
  </main>;
}
