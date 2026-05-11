// Build timestamp + branch name injected by Vite's `define` config in
// vite.config.ts. Visible in the app footer to make it obvious which build
// is loaded — useful when verifying that a hard reload actually picked up
// new code, and when a non-main branch is deployed for live testing.
export const BUILD_TIME: string = __BUILD_TIME__;
export const BUILD_BRANCH: string = __BUILD_BRANCH__;
