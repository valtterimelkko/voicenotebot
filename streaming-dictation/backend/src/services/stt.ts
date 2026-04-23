import { Readable } from 'stream';

export async function streamTranscribe(audioStream: Readable): Promise<string> {
  throw new Error('not implemented');
}

export async function batchTranscribe(audioBuffer: Buffer): Promise<string> {
  throw new Error('not implemented');
}
