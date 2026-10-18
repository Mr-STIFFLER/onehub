import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';

await migrate();
const app = await buildApp();
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
