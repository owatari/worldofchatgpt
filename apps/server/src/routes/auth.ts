import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { credentialsSchema, type AuthResponse } from '@worldofchatgpt/shared';
import { db } from '../database/index.js';
import { users } from '../database/schema.js';
import { getCharacterForUser, getUserByUsername, toCharacterSummary } from '../database/queries.js';

const issueToken = (app: FastifyInstance, userId: string): string => app.jwt.sign({ sub: userId }, { expiresIn: '7d' });

export const registerAuthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.post('/auth/register', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid username or password.', details: parsed.error.flatten() });

    if (await getUserByUsername(parsed.data.username)) return reply.code(409).send({ error: 'Username is already taken.' });

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const [created] = await db.insert(users).values({ username: parsed.data.username, passwordHash }).returning({ id: users.id });
    if (!created) return reply.code(500).send({ error: 'Could not create account.' });

    const response: AuthResponse = { token: issueToken(app, created.id), character: null };
    return reply.code(201).send(response);
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid username or password.' });

    const user = await getUserByUsername(parsed.data.username);
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid username or password.' });
    }

    const character = await getCharacterForUser(user.id);
    const response: AuthResponse = {
      token: issueToken(app, user.id),
      character: character ? toCharacterSummary(character) : null,
    };
    return reply.send(response);
  });
};
