import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../db.js';
import { config } from '../config.js';
import { authenticate, HttpError, parse, publicUser, userId, type UserRow } from '../http.js';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, 'Usernames are 3–24 characters: letters, numbers, dots and underscores');
const password = z.string().min(8, 'Passwords need at least 8 characters').max(200);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #C9A961');

export async function authRoutes(app: FastifyInstance) {
  const sign = (u: UserRow) => app.jwt.sign({ sub: u.id }, { expiresIn: '30d' });

  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(
      z.object({ username, password, displayName: z.string().trim().min(1).max(32).optional() }),
      req.body,
    );
    const exists = await one('SELECT 1 FROM users WHERE username = $1', [body.username]);
    if (exists) throw new HttpError(409, 'That username is taken');

    const firstUser = !(await one('SELECT 1 FROM users LIMIT 1'));
    const hash = await bcrypt.hash(body.password, 12);
    const user = (await one<UserRow>(
      `INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING *`,
      [body.username, body.displayName ?? body.username, hash, firstUser && config.firstUserIsAdmin],
    ))!;
    return { token: sign(user), user: { ...publicUser(user), isAdmin: user.is_admin } };
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ username, password: z.string() }), req.body);
    const user = await one<UserRow & { password_hash: string; disabled: boolean }>(
      'SELECT * FROM users WHERE username = $1',
      [body.username],
    );
    if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
      throw new HttpError(401, 'Wrong username or password');
    }
    if (user.disabled) throw new HttpError(403, 'This account has been disabled');
    return { token: sign(user), user: { ...publicUser(user), isAdmin: user.is_admin } };
  });

  app.get('/me', { preHandler: authenticate }, async (req) => {
    const user = await one<UserRow>('SELECT * FROM users WHERE id = $1', [userId(req)]);
    if (!user) throw new HttpError(401, 'Sign in required');
    return { ...publicUser(user), isAdmin: user.is_admin };
  });

  app.patch('/me', { preHandler: authenticate }, async (req) => {
    const body = parse(
      z.object({
        displayName: z.string().trim().min(1).max(32).optional(),
        bio: z.string().max(190).optional(),
        statusText: z.string().max(64).optional(),
        accent: hex.optional(),
      }),
      req.body,
    );
    const user = (await one<UserRow>(
      `UPDATE users SET
         display_name = COALESCE($2, display_name),
         bio = COALESCE($3, bio),
         status_text = COALESCE($4, status_text),
         accent = COALESCE($5, accent)
       WHERE id = $1 RETURNING *`,
      [userId(req), body.displayName, body.bio, body.statusText, body.accent],
    ))!;
    return { ...publicUser(user), isAdmin: user.is_admin };
  });

  app.get('/users/:id', { preHandler: authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const user = await one<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    if (!user) throw new HttpError(404, 'User not found');
    return publicUser(user);
  });
}
