export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function getSentryEnvironment(): string {
  return (
    optionalEnv('SENTRY_ENVIRONMENT') ?? optionalEnv('VERCEL_ENV') ?? 'development'
  );
}
