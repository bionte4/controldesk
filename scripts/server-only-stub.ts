// Empty stub replacing the real `server-only` package when scripts
// execute outside the Next.js runtime (tsx / node). The real module
// throws unconditionally so it can gate client-side webpack bundles;
// tsx doesn't do that gating, so an empty module is the correct
// substitute.
export {};
