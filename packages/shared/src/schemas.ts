import { z } from 'zod';

export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_]+$/),
  password: z.string().min(8).max(128),
});

export const createCharacterSchema = z.object({
  name: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9 _-]+$/),
  classId: z.enum(['warrior', 'mage', 'cleric']),
});

export const movementInputSchema = z.object({
  type: z.literal('move'),
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
});

export const targetInputSchema = z.object({
  type: z.literal('target'),
  targetId: z.string().nullable(),
});

export const castInputSchema = z.object({
  type: z.literal('cast'),
  abilityId: z.string().min(1),
  targetId: z.string().nullable(),
});

export const respawnInputSchema = z.object({ type: z.literal('respawn') });
export const clientMessageSchema = z.discriminatedUnion('type', [
  movementInputSchema,
  targetInputSchema,
  castInputSchema,
  respawnInputSchema,
]);

export type CredentialsInput = z.infer<typeof credentialsSchema>;
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
