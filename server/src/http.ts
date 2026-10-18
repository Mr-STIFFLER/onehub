import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const issue = res.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${issue?.message ?? 'Invalid request'}`);
  }
  return res.data;
}

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

export function userId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Sign in required' });
  }
}

export type UserRow = {
  id: string;
  username: string;
  display_name: string;
  accent: string;
  bio: string;
  status_text: string;
  is_admin: boolean;
  created_at: Date;
};

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    accent: u.accent,
    bio: u.bio,
    statusText: u.status_text,
  };
}

export type MessageRow = {
  id: string;
  channel_id: string | null;
  dm_id: string | null;
  content: string;
  created_at: Date;
  edited_at: Date | null;
  author_id: string;
  username: string;
  display_name: string;
  accent: string;
};

export const MESSAGE_SELECT = `
  SELECT m.id, m.channel_id, m.dm_id, m.content, m.created_at, m.edited_at,
         m.author_id, u.username, u.display_name, u.accent
  FROM messages m JOIN users u ON u.id = m.author_id`;

export function messageOut(m: MessageRow) {
  return {
    id: m.id,
    channelId: m.channel_id,
    dmId: m.dm_id,
    content: m.content,
    createdAt: m.created_at,
    editedAt: m.edited_at,
    author: { id: m.author_id, username: m.username, displayName: m.display_name, accent: m.accent },
  };
}
