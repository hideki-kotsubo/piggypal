import pkg from '../../package.json'

// Injected by vite.config.ts's `define` at build time (docs/58 D218).
declare const __APP_COMMIT__: string

export const APP_VERSION = pkg.version
export const APP_COMMIT = __APP_COMMIT__
