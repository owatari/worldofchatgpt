import { describe, expect, it } from 'vitest';
import { applyDamage, applyHeal, calculateDamage, canUseCooldown, isInRange } from './combat.js';
import { CLASS_DEFINITIONS } from './definitions.js';
import { grantXp } from './progression.js';

const warrior = CLASS_DEFINITIONS.warrior;
const slimeStats = { maxHp: 100, attack: 8, magicPower: 0, defense: 2, moveSpeed: 2.5 };

describe('game core combat', () => {
  it('calculates damage from attack and defense', () => {
    expect(calculateDamage(warrior.basicAttack, warrior.baseStats, slimeStats)).toBe(24);
  });

  it('rejects an active cooldown', () => {
    expect(canUseCooldown(999, 1000)).toBe(false);
    expect(canUseCooldown(1000, 1000)).toBe(true);
  });

  it('checks range in the ground plane', () => {
    expect(isInRange({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 2.2)).toBe(true);
    expect(isInRange({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 2.2)).toBe(false);
  });

  it('marks zero hp as dead', () => {
    expect(applyDamage(10, 10)).toEqual({ hp: 0, dead: true });
  });

  it('grants xp and levels up at 100 xp', () => {
    expect(grantXp(1, 90, 25)).toEqual({ level: 2, xp: 15, levelsGained: 1 });
  });

  it('never heals above max hp', () => {
    expect(applyHeal(90, 100, 50)).toBe(100);
  });
});
