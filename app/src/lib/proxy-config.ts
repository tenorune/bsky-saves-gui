import { get, set, del } from 'idb-keyval';

const KEY = 'proxy-config:v1';

export interface ProxyConfig {
  readonly url: string;
  readonly sharedSecret: string;
}

export async function saveProxyConfig(config: ProxyConfig): Promise<void> {
  await set(KEY, config);
}

export async function loadProxyConfig(): Promise<ProxyConfig | null> {
  const v = (await get(KEY)) as ProxyConfig | undefined;
  return v ?? null;
}

export async function clearProxyConfig(): Promise<void> {
  await del(KEY);
}
