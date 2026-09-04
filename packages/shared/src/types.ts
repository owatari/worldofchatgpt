export type EntityId = string;
export type ClassId = 'warrior' | 'mage' | 'cleric';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CharacterSummary {
  id: string;
  name: string;
  classId: ClassId;
  level: number;
  xp: number;
}

export interface VisualEquipment {
  head: string | null;
  shoulders: string | null;
  chest: string | null;
  hands: string | null;
  legs: string | null;
  feet: string | null;
  accessory: string | null;
  weapon: string | null;
  offhand: string | null;
}

export interface PlayerSnapshot extends CharacterSummary {
  entityId: EntityId;
  position: Vec3;
  rotation: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Optional until the inventory/equipment service becomes authoritative. */
  equipment?: VisualEquipment;
}

export interface MonsterSnapshot {
  entityId: EntityId;
  name: string;
  position: Vec3;
  rotation: number;
  hp: number;
  maxHp: number;
  dead: boolean;
}
