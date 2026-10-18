import type { FastifyInstance } from 'fastify';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { one } from '../db.js';
import { config } from '../config.js';
import { hub } from '../gateway.js';
import { authenticate, HttpError, idParams, parse, userId } from '../http.js';
import { has, NotFoundError, P, require } from '../permissions.js';

export async function voiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/voice/status', async () => ({ configured: Boolean(config.livekit.url && config.livekit.apiKey) }));

  /** Issues a LiveKit access token scoped to one voice channel, with publish rights from the member's permissions. */
  app.post('/channels/:id/voice/join', async (req) => {
    const { id } = parse(idParams, req.params);
    const me = userId(req);
    const ch = await one('SELECT * FROM channels WHERE id = $1', [id]);
    if (!ch) throw new NotFoundError('Channel not found');
    if (ch.kind !== 'voice') throw new HttpError(400, 'Not a voice channel');
    const perms = await require(ch.community_id, me, P.CONNECT_VOICE);
    if (!config.livekit.url || !config.livekit.apiKey) {
      throw new HttpError(503, 'Voice server is not configured on this instance');
    }
    const user = await one('SELECT display_name, accent FROM users WHERE id = $1', [me]);
    const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
      identity: me,
      name: user?.display_name,
      metadata: JSON.stringify({ accent: user?.accent }),
      ttl: '6h',
    });
    const canSpeak = has(perms, P.SPEAK);
    token.addGrant({
      room: `channel:${id}`,
      roomJoin: true,
      canSubscribe: true,
      canPublish: canSpeak,
      canPublishData: true,
      canPublishSources: canSpeak
        ? has(perms, P.VIDEO)
          ? [TrackSource.MICROPHONE, TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
          : [TrackSource.MICROPHONE]
        : [],
    });
    const jwt = await token.toJwt();
    hub.voiceJoin(ch.community_id, id, me);
    return { url: config.livekit.url, token: jwt, canSpeak, canVideo: has(perms, P.VIDEO) };
  });

  app.post('/channels/:id/voice/leave', async (req) => {
    const { id } = parse(idParams, req.params);
    hub.voiceLeave(id, userId(req));
    return { ok: true };
  });
}
