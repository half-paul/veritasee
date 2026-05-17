import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits one JSON line per info call to stdout', () => {
    logger.info('hello', { route: '/x', status: 200 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: 'info', msg: 'hello', route: '/x', status: 200 });
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits warn calls to stdout', () => {
    logger.warn('warning');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(line.level).toBe('warn');
  });

  it('routes error calls to stderr', () => {
    logger.error('boom', { err: 'kaboom' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const line = JSON.parse(errorSpy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: 'error', msg: 'boom', err: 'kaboom' });
  });

  it('serializes nested fields without dropping them', () => {
    logger.info('m', { nested: { a: 1, b: ['x', 'y'] } });
    const line = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(line.nested).toEqual({ a: 1, b: ['x', 'y'] });
  });
});
