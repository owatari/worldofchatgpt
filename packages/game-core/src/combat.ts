import type { Vec3 } from '@worldofchatgpt/shared';
import type { AbilityDefinition, Stats } from './definitions.js';

export const distance2D = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);

export const isInRange = (a: Vec3, b: Vec3, range: number): boolean => distance2D(a, b) <= range;

export const canUseCooldown = (now: number, readyAt: number): boolean => now >= readyAt;

export const calculateDamage = (ability: AbilityDefinition, attacker: Stats, defender: Stats): number => {
  if (ability.damageType === 'heal') return 0;
  const offense = ability.damageType === 'physical' ? attacker.attack : attacker.magicPower;
  return Math.max(1, Math.round(ability.basePower + offense * 0.6 - defender.defense * 0.45));
};

export const applyDamage = (hp: number, amount: number): { hp: number; dead: boolean } => {
  const nextHp = Math.max(0, hp - Math.max(0, amount));
  return { hp: nextHp, dead: nextHp <= 0 };
};

export const calculateHeal = (ability: AbilityDefinition, caster: Stats): number =>
  Math.max(0, Math.round(ability.basePower + caster.magicPower * 0.7));

export const applyHeal = (hp: number, maxHp: number, amount: number): number =>
  Math.min(maxHp, hp + Math.max(0, amount));
