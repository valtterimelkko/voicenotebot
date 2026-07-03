/**
 * Tiny dependency-free structured logger.
 *
 * Emits one JSON object per line to stdout (info/warn) or stderr (error), so
 * journald captures parseable records. The shape is the foundation that Tier 2
 * metrics/alerting would build on. Kept intentionally small for Tier 1.
 */
type LogPayload = Record<string, unknown> | string;

function emit(level: 'info' | 'warn' | 'error', payload: LogPayload): void {
  const base = { ts: new Date().toISOString(), level };
  const record = typeof payload === 'string'
    ? { ...base, msg: payload }
    : { ...base, ...payload };
  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (payload: LogPayload) => emit('info', payload),
  warn: (payload: LogPayload) => emit('warn', payload),
  error: (payload: LogPayload) => emit('error', payload),
};
