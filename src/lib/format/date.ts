/**
 * ControlDesk — timezone-aware date formatting (rules §18).
 *
 * Semua kolom `timestamptz` di Postgres disimpan UTC. Ketika ditampilkan
 * di UI, WAJIB dikonversi ke zona waktu tenant (default `Asia/Jakarta`)
 * menggunakan helper di file ini.
 *
 * DILARANG:
 *   - `new Date().toISOString().split("T")[0]` untuk tanggal bisnis (UTC bocor).
 *   - `date.setHours()` untuk business logic (mutable, TZ-naive).
 *
 * Gunakan `formatInTz`, `formatIsoDateInTz`, atau `nowInTz` sebagai gantinya.
 */

import { format as formatFns, parseISO } from "date-fns";
import { formatInTimeZone, toZonedTime, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

// ---------------------------------------------------------------------------
// Formatters.
// ---------------------------------------------------------------------------

export type Formattable = Date | string | number;

function toDate(value: Formattable): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return parseISO(value);
}

/**
 * Format sebuah instan (`Date` / ISO string / epoch ms) ke string dalam
 * zona waktu tertentu (default `Asia/Jakarta`).
 *
 * @example formatInTz("2026-08-04T15:30:00Z") // "04 Agu 2026, 22.30"
 */
export function formatInTz(
  value: Formattable,
  pattern: string = "dd MMM yyyy, HH:mm",
  timezone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(toDate(value), timezone, pattern);
}

/**
 * Return ISO date-only string ("2026-08-04") di zona waktu tertentu.
 * Aman untuk key roster / payroll / cutoff bulanan.
 */
export function formatIsoDateInTz(
  value: Formattable,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  return formatInTimeZone(toDate(value), timezone, "yyyy-MM-dd");
}

/**
 * Return `Date` yang merepresentasikan "sekarang" di zona waktu tenant.
 * Hasilnya tetap `Date` di UTC, tapi component fields (`getHours()`, dst)
 * akan sesuai TZ ketika di-format via `formatInTz`.
 */
export function nowInTz(timezone: string = DEFAULT_TIMEZONE): Date {
  return toZonedTime(new Date(), timezone);
}

/**
 * Convert "wall-clock" di zona waktu tenant (mis. jam 08:00 Asia/Jakarta)
 * ke UTC `Date` untuk disimpan ke DB. Berguna untuk cron / scheduling.
 */
export function tzWallClockToUtc(
  isoWallClock: string,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  return fromZonedTime(isoWallClock, timezone);
}

// ---------------------------------------------------------------------------
// Locale-aware short forms.
// ---------------------------------------------------------------------------

/** Format relatif ringkas (mis. "5 mnt lalu") — thin wrapper di sekitar
 * date-fns yang menganggap sumbernya adalah UTC ISO. */
export function formatRelative(
  from: Formattable,
  to: Formattable = new Date(),
): string {
  const diffMs = toDate(to).getTime() - toDate(from).getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);
  const past = diffMs >= 0;
  if (minutes < 1) return past ? "baru saja" : "sebentar lagi";
  if (minutes < 60) return past ? `${minutes} mnt lalu` : `dalam ${minutes} mnt`;
  if (hours < 24) return past ? `${hours} jam lalu` : `dalam ${hours} jam`;
  return past ? `${days} hari lalu` : `dalam ${days} hari`;
}

/**
 * Format tanggal saja tanpa timezone concern — untuk kolom `date` di DB
 * (bukan `timestamptz`).
 */
export function formatDateOnly(iso: string, pattern = "dd MMM yyyy"): string {
  return formatFns(parseISO(iso), pattern);
}
