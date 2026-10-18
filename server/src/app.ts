import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { one } from './db.js';
import { hub } from './gateway.js';
import { authRoutes } from './routes/auth.js';
import { communityRoutes } from './routes/communities.js';
import { messageRoutes } from './routes/messages.js';
import { safetyRoutes } from './routes/safety.js';
import { voiceRoutes } from './routes/voice.js';

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 256 * 1024 });

  await app.register(cors, { origin: config.production ? config.corsOrigins : true, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server' : err.message });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(communityRoutes);
      await api.register(messageRoutes);
      await api.register(safetyRoutes);
      await api.register(voiceRoutes);
    },
    { prefix: '/api' },
  );

  // Real-time gateway. Clients connect with ?token=<jwt> and receive JSON events.
  app.get('/gateway', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    let sub: string;
    try {
      sub = (app.jwt.verify(token ?? '') as { sub: string }).sub;
    } catch {
      socket.close(4001, 'Unauthorized');
      return;
    }
    const user = await one('SELECT disabled FROM users WHERE id = $1', [sub]);
    if (!user || user.disabled) {
      socket.close(4003, 'Account unavailable');
      return;
    }
    hub.attach(sub, socket);
    socket.send(JSON.stringify({ t: 'READY', d: { userId: sub, online: hub.onlineUserIds() } }));
    socket.on('message', (raw) => {
      // Only heartbeats are accepted client→server; everything else goes through the REST API.
      if (raw.toString() === 'ping') socket.send('pong');
    });
  });

  // Serve the built web client when it is present (single-binary style deploys).
  const clientDist = resolve(process.env.CLIENT_DIST ?? '../client/dist');
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/gateway')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
