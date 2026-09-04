import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createCharacterSchema, type ClassId } from '@worldofchatgpt/shared';
import { CLASS_DEFINITIONS } from '@worldofchatgpt/game-core';
import { db } from '../database/index.js';
import { characters } from '../database/schema.js';
import { getCharacterForUser, toCharacterSummary } from '../database/queries.js';

const userIdFromRequest = async (request: FastifyRequest): Promise<string> => {
  const payload = await request.jwtVerify<{ sub: string }>();
  return payload.sub;
};

export const registerCharacterRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/me', async (request, reply) => {
    try {
      const userId = await userIdFromRequest(request);
      const character = await getCharacterForUser(userId);
      return reply.send({ character: character ? toCharacterSummary(character) : null });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }
  });

  app.post('/characters', async (request, reply) => {
    let userId: string;
    try {
      userId = await userIdFromRequest(request);
    } catch {
      return reply.code(401).send({ error: 'Unauthorized.' });
    }

    const parsed = createCharacterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid character.', details: parsed.error.flatten() });
    if (await getCharacterForUser(userId)) return reply.code(409).send({ error: 'This account already has a character.' });

    const classId = parsed.data.classId as ClassId;
    if (!CLASS_DEFINITIONS[classId]) return reply.code(400).send({ error: 'Unknown class.' });

    try {
      const [created] = await db.insert(characters).values({ userId, name: parsed.data.name, classId }).returning();
      if (!created) return reply.code(500).send({ error: 'Could not create character.' });
      return reply.code(201).send({ character: toCharacterSummary(created) });
    } catch {
      return reply.code(409).send({ error: 'Character name is already taken.' });
    }
  });
};
