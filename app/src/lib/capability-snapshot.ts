export type HelperFacts =
  | { readonly detected: false }
  | {
      readonly detected: true;
      readonly version: string;
      readonly features: readonly string[];
    };

export type CapabilitySnapshot = {
  readonly helper: HelperFacts;
  readonly fetch:    { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly enrich:   { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly threads:  { readonly kind: 'helper' } | { readonly kind: 'pyodide' };
  readonly images:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'operator-worker' };
  readonly articles:
    | { readonly kind: 'helper' }
    | { readonly kind: 'user-worker'; readonly url: string }
    | { readonly kind: 'none' };
};

export const EMPTY_SNAPSHOT: CapabilitySnapshot = {
  helper: { detected: false },
  fetch:    { kind: 'pyodide' },
  enrich:   { kind: 'pyodide' },
  threads:  { kind: 'pyodide' },
  images:   { kind: 'operator-worker' },
  articles: { kind: 'none' },
};
