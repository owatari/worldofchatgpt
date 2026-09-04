import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCharacterRoutes } from './routes/character.js';
import { GameWorld } from './game/world.js';

export const buildServer = async () => {
  const app = Fastify({
    logger: true,
    // WebSocket auth uses a query token because browsers cannot attach a custom
    // Authorization header to the upgrade request. Suppress Fastify's automatic
    // request logs so authenticated URLs and API Authorization headers are never
    // written to logs.
    logController: new LogController({ disableRequestLogging: true }),
  });
  await app.register(cors, { origin: config.CLIENT_ORIGIN });
  await app.register(jwt, { secret: config.JWT_SECRET });
  await app.register(websocket);

  await registerAuthRoutes(app);
  await registerCharacterRoutes(app);
  app.get('/health', async () => ({ ok: true }));

  const world = new GameWorld(app);
  world.start();
  app.addHook('onClose', async () => world.stop());
  app.get('/ws', { websocket: true }, (socket, request) => {
    void world.connect(socket, request);
  });

  return app;
};
