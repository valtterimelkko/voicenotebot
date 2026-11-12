/**
 * The ffmpeg normaliser behind a short-decode retry (round 2, owner: "a long Android dictation comes back whole").
 *
 * A short decode is re-decoded from the raw recording: ffmpeg reads the whole file, resamples to 16 kHz mono PCM
 * WAV (the container the upstreams cannot misread — proven on the lab against xAI and the host's local ASR) and
 * slices it into ≤ 90 s parts, so one request never carries more than 90 s. ffmpeg also says how much audio it
 * actually decoded, which is the number that tells a short *upload* apart from a partial upstream decode.
 *
 * These tests never run the real binary: the runner is injected, and the parser is pure.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decodedSecondsFromProgress, decodeToSegments, AudioDecodeError } from '../src/services/audio-normalise';

describe('decodedSecondsFromProgress', () => {
  it('reads the last out_time_us of a real ffmpeg -progress stream', () => {
    const output = [
      'out_time_us=0',
      'out_time_ms=0',
      'progress=continue',
      'out_time_us=278400000',
      'out_time_ms=278400000',
      'progress=end',
      '',
    ].join('\n');
    expect(decodedSecondsFromProgress(output)).toBe(278.4);
  });

  it('is undefined when ffmpeg said nothing usable', () => {
    expect(decodedSecondsFromProgress('')).toBeUndefined();
    expect(decodedSecondsFromProgress('progress=end\n')).toBeUndefined();
    expect(decodedSecondsFromProgress('out_time_us=not-a-number\n')).toBeUndefined();
  });
});

describe('decodeToSegments', () => {
  it('returns the parts in recording order and the seconds ffmpeg decoded, then removes its temp dir', async () => {
    let seenCwd = '';
    const audio = Buffer.from('whole recording bytes');
    const result = await decodeToSegments(audio, {
      run: async (_bin, _args, cwd) => {
        seenCwd = cwd;
        // ffmpeg writes part000…partNNN into its working directory; the fake writes two.
        fs.writeFileSync(path.join(cwd, 'part001.wav'), Buffer.from('second'));
        fs.writeFileSync(path.join(cwd, 'part000.wav'), Buffer.from('first'));
        return 'out_time_us=180000000\nprogress=end\n';
      },
    });

    expect(result.decodedSec).toBe(180);
    expect(result.segments.map((s) => s.toString())).toEqual(['first', 'second']);
    // The input was handed to ffmpeg under the temp dir, with the recording's bytes.
    expect(fs.existsSync(seenCwd)).toBe(false);
  });

  it('leaves nothing behind when ffmpeg fails', async () => {
    let seenCwd = '';
    await expect(
      decodeToSegments(Buffer.from('bytes'), {
        run: async (_bin, _args, cwd) => {
          seenCwd = cwd;
          throw new AudioDecodeError('ffmpeg exited 1: invalid data');
        },
      }),
    ).rejects.toBeInstanceOf(AudioDecodeError);
    expect(fs.existsSync(seenCwd)).toBe(false);
  });

  it('treats an ffmpeg run that produced no audio as a failure', async () => {
    await expect(
      decodeToSegments(Buffer.from('bytes'), { run: async () => 'out_time_us=0\nprogress=end\n' }),
    ).rejects.toBeInstanceOf(AudioDecodeError);
  });

  it('asks ffmpeg for 16 kHz mono PCM WAV in ≤ 90 s segments by default', async () => {
    const seen: { bin: string; args: string[] } = { bin: '', args: [] };
    await decodeToSegments(Buffer.from('bytes'), {
      run: async (bin, args, cwd) => {
        seen.bin = bin;
        seen.args = args;
        fs.writeFileSync(path.join(cwd, 'part000.wav'), Buffer.from('x'));
        return 'out_time_us=1000000\nprogress=end\n';
      },
    });
    const joined = seen.args.join(' ');
    expect(seen.bin).toBe('/usr/bin/ffmpeg');
    expect(joined).toContain('-ar 16000');
    expect(joined).toContain('-ac 1');
    expect(joined).toContain('pcm_s16le');
    expect(joined).toContain('-segment_time 90');
    expect(joined).toContain('part%03d.wav');
    expect(seen.args).toContain('-progress');
  });
});
