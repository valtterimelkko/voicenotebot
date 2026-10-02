/**
 * Single source of truth for the model identities this backend actually runs.
 *
 * These constants live alone in a side-effect-free module so that routes can
 * report the truth to the UI without importing service modules that construct
 * API clients (import side effects broke the e2e suite once already).
 */

/** Cleanup (transcript post-processing) model served by the OpenAI API. */
export const CLEANUP_MODEL = 'gpt-5-nano';

/**
 * gpt-5-nano is a reasoning model; its native floor is 'minimal' (there is no
 * off). The default 'medium' pass measured ~4-5s per call (23s on the longest
 * real transcript) and dominated finish latency, so the floor is pinned.
 */
export const CLEANUP_REASONING_EFFORT = 'minimal' as const;

/** Speech-to-text model used for chunk and batch transcription. */
export const STT_MODEL = 'gpt-4o-mini-transcribe';
