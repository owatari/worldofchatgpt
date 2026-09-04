import type { Stats } from './definitions.js';

export interface MonsterDefinition {
  id: string;
  name: string;
  stats: Stats;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  xpReward: number;
  respawnMs: number;
}

export const TRAINING_SLIME: MonsterDefinition = {
  id: 'training-slime',
  name: 'Training Slime',
  stats: { maxHp: 100, attack: 8, magicPower: 0, defense: 2, moveSpeed: 2.5 },
  aggroRange: 11,
  attackRange: 1.8,
  attackCooldownMs: 1600,
  xpReward: 25,
  respawnMs: 5000,
};
