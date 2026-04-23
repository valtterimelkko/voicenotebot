import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  passwordHash: process.env.PASSWORD_HASH || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  kimiApiKey: process.env.KIMI_API_KEY || '',
  defaultCleanupModel: (process.env.DEFAULT_CLEANUP_MODEL || 'kimi') as 'kimi' | 'gpt-5-nano',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '14', 10),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'transcripts.db'),
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
};
