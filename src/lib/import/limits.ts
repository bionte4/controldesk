/**
 * Bulk-import limits — shared by both server (parser guard) and client
 * (upload widget's file-size pre-check). Kept in a plain module without
 * a `"server-only"` sentinel so it can be imported by client components.
 */

const MAX_ROWS_HARD_CAP = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const IMPORT_LIMITS = {
  maxRowsPerFile: 500,
  maxRowsHardCap: MAX_ROWS_HARD_CAP,
  maxFileBytes: MAX_FILE_BYTES,
} as const;
