import type { ClassId, VisualEquipment } from './types.js';

export const STARTER_VISUAL_EQUIPMENT: Record<ClassId, VisualEquipment> = {
  warrior: {
    head: 'iron-open-helm',
    shoulders: 'iron-pauldrons',
    chest: 'red-brigandine',
    hands: 'iron-gauntlets',
    legs: 'dark-trousers',
    feet: 'iron-boots',
    accessory: 'bronze-war-charm',
    weapon: 'iron-longsword',
    offhand: 'round-kite-shield',
  },
  mage: {
    head: 'arcane-circlet',
    shoulders: 'apprentice-mantle',
    chest: 'violet-battlerobe',
    hands: 'arcane-gloves',
    legs: 'traveler-trousers',
    feet: 'soft-mage-boots',
    accessory: 'mana-pendant',
    weapon: 'oak-focus-staff',
    offhand: null,
  },
  cleric: {
    head: 'sun-circlet',
    shoulders: 'sun-pauldrons',
    chest: 'ivory-vestment',
    hands: 'ivory-gloves',
    legs: 'brown-trousers',
    feet: 'sun-boots',
    accessory: 'sun-pendant',
    weapon: 'sanctified-mace',
    offhand: null,
  },
};
