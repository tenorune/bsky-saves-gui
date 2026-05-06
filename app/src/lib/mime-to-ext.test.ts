import { describe, expect, it } from 'vitest';
import { mimeToExt } from './mime-to-ext';

describe('mimeToExt', () => {
  it('maps common image mime types', () => {
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('image/gif')).toBe('gif');
    expect(mimeToExt('image/avif')).toBe('avif');
    expect(mimeToExt('image/svg+xml')).toBe('svg');
    expect(mimeToExt('image/heic')).toBe('heic');
    expect(mimeToExt('image/heif')).toBe('heif');
  });

  it('is case-insensitive', () => {
    expect(mimeToExt('Image/PNG')).toBe('png');
    expect(mimeToExt('IMAGE/JPEG')).toBe('jpg');
  });

  it('strips parameters after a semicolon', () => {
    expect(mimeToExt('image/png; charset=binary')).toBe('png');
  });

  it('falls back to "bin" for unknown types', () => {
    expect(mimeToExt('application/octet-stream')).toBe('bin');
    expect(mimeToExt('')).toBe('bin');
    expect(mimeToExt('weird/format')).toBe('bin');
  });
});
