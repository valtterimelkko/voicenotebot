/**
 * Single source of truth for the model identities this backend actually runs.
 *
 * These constants live alone in a side-effect-free module so that routes can
 * report the truth to the UI without importing service modules that construct
 * API clients (import side effects broke the e2e suite once already).
 */

/** Cleanup (transcript post-processing) model — served via OpenRouter. */
export const CLEANUP_MODEL = 'google/gemma-4-26b-a4b-it';

/** Route the cleanup model is served on. */
export const CLEANUP_PROVIDER = 'openrouter';

/** Speech-to-text model used for chunk and batch transcription. */
export const STT_MODEL = 'gpt-4o-mini-transcribe';
