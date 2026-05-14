// Structured JSON logger. Emits one JSON line per call to stdout/stderr so Vercel
// log drains can query fields without parsing free-form text. Callers MUST pass
// `req.nextUrl.pathname` only, never `req.nextUrl.search` — query strings can
// carry tokens and must not appear in logs.

type LogLevel = 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

function emit(level: LogLevel, msg: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(msg: string, fields: LogFields = {}): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields: LogFields = {}): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields: LogFields = {}): void {
    emit('error', msg, fields);
  },
};
