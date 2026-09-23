import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkWebXrAvailability } from '../src/ar/check-availability';

describe('checkWebXrAvailability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error テスト用にnavigator.xrを削除する
    delete (navigator as Navigator & { xr?: unknown }).xr;
  });

  it('非セキュアコンテキストなら非対応理由を返す', async () => {
    vi.stubGlobal('isSecureContext', false);
    const result = await checkWebXrAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });

  it('navigator.xrが無ければ非対応理由を返す', async () => {
    vi.stubGlobal('isSecureContext', true);
    const result = await checkWebXrAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('WebXR');
  });

  it('immersive-ar非対応なら理由を返す', async () => {
    vi.stubGlobal('isSecureContext', true);
    (navigator as Navigator & { xr?: unknown }).xr = {
      isSessionSupported: vi.fn().mockResolvedValue(false),
    };
    const result = await checkWebXrAvailability();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('AR');
  });

  it('immersive-ar対応なら利用可能と判定する', async () => {
    vi.stubGlobal('isSecureContext', true);
    (navigator as Navigator & { xr?: unknown }).xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };
    const result = await checkWebXrAvailability();
    expect(result.available).toBe(true);
  });
});
