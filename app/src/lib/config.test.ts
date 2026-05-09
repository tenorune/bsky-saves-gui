import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('config', () => {
  const originalEnv = { ...import.meta.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(import.meta.env)) {
      if (key.startsWith('VITE_')) {
        // @ts-ignore - test-only mutation
        delete import.meta.env[key];
      }
    }
    Object.assign(import.meta.env, originalEnv);
  });

  it('exposes all required values from import.meta.env', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test App',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op.example',
      VITE_BEACON_AT_URI: 'at://did:plc:abc/app.bsky.feed.post/xyz',
      VITE_DEFAULT_PDS: 'https://pds.example',
      VITE_HELPER_ORIGIN: 'http://127.0.0.1:7878',
      VITE_REPO_URL: 'https://github.com/example/repo',
      VITE_PYODIDE_VERSION: '0.26.4',
    });

    const { config } = await import('./config');

    expect(config.appName).toBe('Test App');
    expect(config.appDomain).toBe('test.example');
    expect(config.operatorHandle).toBe('op.example');
    expect(config.beaconAtUri).toBe('at://did:plc:abc/app.bsky.feed.post/xyz');
    expect(config.defaultPds).toBe('https://pds.example');
    expect(config.helperOrigin).toBe('http://127.0.0.1:7878');
    expect(config.repoUrl).toBe('https://github.com/example/repo');
    expect(config.pyodideVersion).toBe('0.26.4');
  });

  it('treats empty VITE_BEACON_AT_URI as null', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
    });

    const { config } = await import('./config');

    expect(config.beaconAtUri).toBeNull();
  });

  it('rejects a non-empty VITE_OPERATOR_IMAGE_PROXY_URL that lacks a scheme', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
      // Bare hostname — exactly the misconfiguration we hit in production.
      VITE_OPERATOR_IMAGE_PROXY_URL: 'bsky-saves-image-proxy.example.workers.dev',
    });

    await expect(import('./config')).rejects.toThrow(/VITE_OPERATOR_IMAGE_PROXY_URL/);
  });

  it('rejects VITE_OPERATOR_IMAGE_PROXY_URL with a non-http scheme', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
      VITE_OPERATOR_IMAGE_PROXY_URL: 'ftp://example.com',
    });

    await expect(import('./config')).rejects.toThrow(/VITE_OPERATOR_IMAGE_PROXY_URL/);
  });

  it('accepts an empty VITE_OPERATOR_IMAGE_PROXY_URL (feature disabled)', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
      VITE_OPERATOR_IMAGE_PROXY_URL: '',
    });

    const { config } = await import('./config');
    expect(config.operatorImageProxyUrl).toBe('');
  });

  it('accepts a well-formed https VITE_OPERATOR_IMAGE_PROXY_URL', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: 'test.example',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
      VITE_OPERATOR_IMAGE_PROXY_URL: 'https://operator.example.workers.dev',
    });

    const { config } = await import('./config');
    expect(config.operatorImageProxyUrl).toBe('https://operator.example.workers.dev');
  });

  it('throws on missing required values at module load time', async () => {
    Object.assign(import.meta.env, {
      VITE_APP_NAME: 'Test',
      VITE_APP_DOMAIN: '',
      VITE_OPERATOR_HANDLE: 'op',
      VITE_BEACON_AT_URI: '',
      VITE_DEFAULT_PDS: 'https://x',
      VITE_HELPER_ORIGIN: 'http://x',
      VITE_REPO_URL: 'https://x',
      VITE_PYODIDE_VERSION: '0.0.0',
    });

    await expect(import('./config')).rejects.toThrow(/VITE_APP_DOMAIN/);
  });
});
