import type { ClassId } from '@worldofchatgpt/shared';

export interface Stats {
  maxHp: number;
  attack: number;
  magicPower: number;
  defense: number;
  moveSpeed: number;
}

export type AbilityKind = 'melee' | 'projectile' | 'self' | 'aoe';
export type DamageType = 'physical' | 'magic' | 'heal';
export type TargetType = 'enemy' | 'self' | 'area';

export interface AbilityDefinition {
  id: string;
  name: string;
  kind: AbilityKind;
  damageType: DamageType;
  basePower: number;
  range: number;
  cooldownMs: number;
  castTimeMs: number;
  targetType: TargetType;
}

export interface ClassDefinition {
  id: ClassId;
  name: string;
  description: string;
  baseStats: Stats;
  basicAttack: AbilityDefinition;
  abilities: [AbilityDefinition, AbilityDefinition];
}

const meleeBasic = (id: string, name: string, basePower: number): AbilityDefinition => ({
  id,
  name,
  kind: 'melee',
  damageType: 'physical',
  basePower,
  range: 2.2,
  cooldownMs: 900,
  castTimeMs: 0,
  targetType: 'enemy',
});

export const CLASS_DEFINITIONS: Record<ClassId, ClassDefinition> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    description: 'Durable melee fighter with powerful close-range attacks.',
    baseStats: { maxHp: 180, attack: 24, magicPower: 4, defense: 12, moveSpeed: 5.3 },
    basicAttack: meleeBasic('warrior-basic', 'Sword Strike', 10),
    abilities: [
      { id: 'power-strike', name: 'Power Strike', kind: 'melee', damageType: 'physical', basePower: 28, range: 2.4, cooldownMs: 4000, castTimeMs: 0, targetType: 'enemy' },
      { id: 'whirlwind', name: 'Whirlwind', kind: 'aoe', damageType: 'physical', basePower: 18, range: 2.8, cooldownMs: 7000, castTimeMs: 0, targetType: 'area' },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    description: 'Fragile ranged caster with high magical damage.',
    baseStats: { maxHp: 115, attack: 5, magicPower: 28, defense: 5, moveSpeed: 5.5 },
    basicAttack: { id: 'mage-basic', name: 'Arcane Bolt', kind: 'projectile', damageType: 'magic', basePower: 8, range: 10, cooldownMs: 1000, castTimeMs: 0, targetType: 'enemy' },
    abilities: [
      { id: 'fireball', name: 'Fireball', kind: 'projectile', damageType: 'magic', basePower: 30, range: 11, cooldownMs: 4500, castTimeMs: 0, targetType: 'enemy' },
      { id: 'frost-bolt', name: 'Frost Bolt', kind: 'projectile', damageType: 'magic', basePower: 22, range: 11, cooldownMs: 3500, castTimeMs: 0, targetType: 'enemy' },
    ],
  },
  cleric: {
    id: 'cleric',
    name: 'Cleric',
    description: 'Balanced holy combatant able to damage enemies and heal.',
    baseStats: { maxHp: 145, attack: 16, magicPower: 18, defense: 9, moveSpeed: 5.2 },
    basicAttack: meleeBasic('cleric-basic', 'Mace Strike', 9),
    abilities: [
      { id: 'holy-bolt', name: 'Holy Bolt', kind: 'projectile', damageType: 'magic', basePower: 24, range: 9, cooldownMs: 4000, castTimeMs: 0, targetType: 'enemy' },
      { id: 'heal', name: 'Heal', kind: 'self', damageType: 'heal', basePower: 30, range: 0, cooldownMs: 7000, castTimeMs: 0, targetType: 'self' },
    ],
  },
};

export const getClassDefinition = (classId: ClassId): ClassDefinition => CLASS_DEFINITIONS[classId];

export const getClassAbilities = (classId: ClassId): AbilityDefinition[] => {
  const definition = getClassDefinition(classId);
  return [definition.basicAttack, ...definition.abilities];
};

export const getAbility = (classId: ClassId, abilityId: string): AbilityDefinition | undefined =>
  getClassAbilities(classId).find((ability) => ability.id === abilityId);
