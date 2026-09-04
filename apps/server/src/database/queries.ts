import { eq } from 'drizzle-orm';
import type { CharacterSummary, ClassId } from '@worldofchatgpt/shared';
import { db } from './index.js';
import { characters, users, type CharacterRow } from './schema.js';

export const getUserByUsername = async (username: string) => {
  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return user ?? null;
};

export const getUserById = async (id: string) => {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
};

export const getCharacterForUser = async (userId: string): Promise<CharacterRow | null> => {
  const [character] = await db.select().from(characters).where(eq(characters.userId, userId)).limit(1);
  return character ?? null;
};

export const toCharacterSummary = (row: CharacterRow): CharacterSummary => ({
  id: row.id,
  name: row.name,
  classId: row.classId as ClassId,
  level: row.level,
  xp: row.xp,
});
