import { describe, it, expect, vi } from 'vitest';
import { createShutdown } from '../src/services/shutdown';

describe('createShutdown', () => {
  it('closes the db, clears the retention timer, and exits the process', () => {
    const close = vi.fn();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const timer = setInterval(() => undefined, 60_000);

    try {
      const shutdown = createShutdown({ close }, timer);
      shutdown('SIGTERM');

      expect(close).toHaveBeenCalledOnce();
      expect(clearSpy).toHaveBeenCalledWith(timer);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      clearSpy.mockRestore();
      exitSpy.mockRestore();
      clearInterval(timer);
    }
  });

  it('still exits even if db.close throws', () => {
    const close = vi.fn(() => { throw new Error('already closed'); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const timer = setInterval(() => undefined, 60_000);

    try {
      createShutdown({ close }, timer)('SIGTERM');
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      clearInterval(timer);
    }
  });
});
