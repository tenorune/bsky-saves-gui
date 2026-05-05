import type { HydrationProgress } from './hydration-state';

export interface BackupStatusLineInput {
  readonly domain: 'images' | 'articles';
  readonly hydration: HydrationProgress;
  /** Description string from describe-backend; null when no backend is available. */
  readonly backendDescription: string | null;
}

export interface BackupStatusLine {
  readonly text: string;
  /** Trailing inline link descriptor when one is present. */
  readonly link: null | { kind: 'setup'; phrase: string };
}

function noun(domain: 'images' | 'articles', total: number): string {
  if (domain === 'images') return total === 1 ? 'image' : 'images';
  return total === 1 ? 'article' : 'articles';
}

export function buildBackupStatusLine(input: BackupStatusLineInput): BackupStatusLine {
  const { domain, hydration, backendDescription } = input;
  const succeeded = hydration.fetched + hydration.skipped;

  if (hydration.status === 'idle' || hydration.total === 0) {
    if (backendDescription === null) {
      return {
        text: 'Not yet saved · no backend available — Set up a backend',
        link: { kind: 'setup', phrase: 'Set up a backend' },
      };
    }
    return {
      text: `Not yet saved · would use ${backendDescription}`,
      link: null,
    };
  }

  if (hydration.status === 'running') {
    return {
      text: `Saving ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}…`,
      link: null,
    };
  }

  if (hydration.status === 'cancelled') {
    return {
      text: `Stopped at ${succeeded} of ${hydration.total} ${noun(domain, hydration.total)}`,
      link: null,
    };
  }

  // done
  if (hydration.failed > 0) {
    return {
      text: `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved (${hydration.failed} failed)`,
      link: null,
    };
  }
  return {
    text: `${succeeded} of ${hydration.total} ${noun(domain, hydration.total)} saved`,
    link: null,
  };
}
