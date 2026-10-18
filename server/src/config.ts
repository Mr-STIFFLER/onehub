const env = process.env;

function required(name: string, fallback?: string): string {
  const v = env[name] ?? fallback;
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

const production = env.NODE_ENV === 'production';

export const config = {
  production,
  port: Number(env.PORT ?? 4000),
  host: env.HOST ?? '0.0.0.0',
  databaseUrl: required('DATABASE_URL', production ? undefined : 'postgres://onehub:onehub@localhost:5432/onehub'),
  jwtSecret: required('JWT_SECRET', production ? undefined : 'dev-only-secret-change-me'),
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,tauri://localhost,http://tauri.localhost').split(','),
  livekit: {
    url: env.LIVEKIT_URL ?? '',
    apiKey: env.LIVEKIT_API_KEY ?? '',
    apiSecret: env.LIVEKIT_API_SECRET ?? '',
  },
  // The first account to register becomes the instance administrator.
  firstUserIsAdmin: env.FIRST_USER_IS_ADMIN !== 'false',
};
