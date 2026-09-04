import type { CharacterSummary, EntityId, MonsterSnapshot, PlayerSnapshot, Vec3 } from './types.js';

export interface AbilityHudState {
  id: string;
  name: string;
  cooldownMs: number;
  readyAt: number;
}

export type CombatEvent =
  | { kind: 'damage'; sourceId: EntityId; targetId: EntityId; amount: number; at: Vec3 }
  | { kind: 'heal'; sourceId: EntityId; targetId: EntityId; amount: number; at: Vec3 }
  | { kind: 'cast'; sourceId: EntityId; targetId: EntityId | null; abilityId: string; at: Vec3 }
  | { kind: 'death'; sourceId: EntityId; targetId: EntityId; at: Vec3 }
  | { kind: 'xp'; sourceId: EntityId; amount: number; level: number; xp: number; at: Vec3 };

export type ServerMessage =
  | {
      type: 'welcome';
      self: PlayerSnapshot;
      monster: MonsterSnapshot;
      abilities: AbilityHudState[];
      selectedTargetId: EntityId | null;
    }
  | {
      type: 'state';
      self: PlayerSnapshot;
      players: PlayerSnapshot[];
      monster: MonsterSnapshot;
      selectedTargetId: EntityId | null;
      abilities: AbilityHudState[];
      serverTime: number;
    }
  | { type: 'combat'; event: CombatEvent }
  | { type: 'error'; code: string; message: string };

export interface AuthResponse {
  token: string;
  character: CharacterSummary | null;
}
