/**
 * Pure constants shared between client + server code. Kept in a separate
 * module (no `server-only` sentinel) so client components can import them
 * without dragging the entire Supabase server client into the browser
 * bundle.
 */

export const BUCKET_ID = "tenant-attachments";
export const SIGNED_URL_TTL_SECONDS = 300;
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}
