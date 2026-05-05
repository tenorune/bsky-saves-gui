import type { HydrationProgress } from './hydration-state';

export interface BackupStatusLineInput {
  readonly domain: 'images' | 'articles';
  readonly hydration: HydrationProgress;
  /** Description string from describe-backend; null when no backend is available. */
  readonly backendDescription: string | null;
}

export interface BackupStatusLine {
  readonly text: string;
}

function noun(domain: 'images' | 'articles', total: number): string {
  if (domain === 'images') return total === 1 ? 'image' : 'images';
  return total === 1 ? 'article' : 'articles';
}

function withBackend(base: string, description: string | null): string {
  if (!description) return base;
  return `${base} · using ${description}`;
}

export function buildBackupStatusLine(input: BackupStatusLineInput): BackupStatusLine {
  const { domain, hydration, backendDescription } = input;
  const succeeded = hydration.fetched + hydration.skipped;

  if (hydration.status === 'idle' || hydration.total === 0) {
    if (backendDescription === null) {
      return { text: 'Not yet saved · no backend available' };
    }
    return { text: `Not yet saved · would use ${backendDescription}` };
  }

  if (hydration.status === 'running') {
    return {
      text: withBackend(
        `Saving ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}…`,
        backendDescription,
      ),
    };
  }

  if (hydration.status === 'cancelled') {
    return {
      text: withBackend(
        `Stopped at ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}`,
        backendDescription,
      ),
    };
  }

  // done
  if (hydration.failed > 0) {
    return {
      text: withBackend(
        `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved (${hydration.failed} failed)`,
        backendDescription,
      ),
    };
  }
  return {
    text: withBackend(
      `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved`,
      backendDescription,
    ),
  };
}
