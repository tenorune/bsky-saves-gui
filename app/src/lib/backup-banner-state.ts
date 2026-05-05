import { writable, type Writable } from 'svelte/store';

/**
 * Tracks whether the image-backup discovery banner is currently visible on
 * the Library route. Used by ArticleBackupBanner to suppress itself while
 * the image banner is showing, so the user makes one decision at a time.
 *
 * Only BackupBanner writes to this store; resetting on destroy ensures the
 * article banner doesn't stay gated forever if the image banner unmounts.
 */
export const imageBannerVisible: Writable<boolean> = writable(false);
