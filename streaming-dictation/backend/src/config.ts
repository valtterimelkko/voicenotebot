import fs from 'fs';
import path from 'path';

function readServiceToken(file: string | undefined): string {
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
  passwordHash: process.env.PASSWORD_HASH || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  /** A local caller's bearer token for the recording routes only (the Wheelhouse on this host); empty = none. */
  serviceToken: readServiceToken(process.env.SERVICE_TOKEN_FILE),
  xaiApiKey: process.env.XAI_API_KEY || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  defaultCleanupModel: (process.env.DEFAULT_CLEANUP_MODEL || 'google/gemma-4-26b-a4b-it') as 'google/gemma-4-26b-a4b-it',
  retentionDays: parseInt(process.env.RETENTION_DAYS || '60', 10),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'transcripts.db'),
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
};
