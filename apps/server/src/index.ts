import { config } from './config.js';
import { runMigrations, sql } from './database/index.js';
import { buildServer } from './server.js';

const main = async (): Promise<void> => {
  await runMigrations();
  const app = await buildServer();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  const shutdown = async (): Promise<void> => {
    await app.close();
    await sql.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
