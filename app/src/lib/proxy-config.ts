import { get, set, del } from 'idb-keyval';

const KEY = 'proxy-config:v1';

export interface ProxyConfig {
  readonly url: string;
  readonly sharedSecret: string;
  readonly supportsArticles: boolean;
}

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  await set(KEY, config);
}

export async function loadProxyConfig(): Promise<ProxyConfig | null> {
  const v = (await get(KEY)) as Partial<ProxyConfig> | undefined;
  if (!v || typeof v.url !== 'string' || typeof v.sharedSecret !== 'string') return null;
  return {
    url: v.url,
    sharedSecret: v.sharedSecret,
    supportsArticles: v.supportsArticles === true,
  };
}

export async function clearProxyConfig(): Promise<void> {
  await del(KEY);
}
