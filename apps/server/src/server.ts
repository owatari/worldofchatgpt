import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCharacterRoutes } from './routes/character.js';
import { GameWorld } from './game/world.js';

export const buildServer = async () => {
  const app = Fastify({
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url.split('?')[0],
            host: request.headers.host,
            remoteAddress: request.socket.remoteAddress,
            remotePort: request.socket.remotePort,
          };
        },
      },
      redact: ['req.headers.authorization'],
    },
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
