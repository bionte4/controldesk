/**
 * ControlDesk — money hygiene (rules §18).
 *
 * DILARANG melakukan aritmetika uang menggunakan JS `number` — floating
 * point akan bocor sen (mis. `0.1 + 0.2 = 0.30000000000000004`). Semua nilai
 * uang WAJIB direpresentasikan sebagai `bigint` cents (satuan terkecil IDR
 * adalah 1 rupiah, jadi cents di sini adalah nol-desimal `bigint`).
 *
 * Konvensi:
 *   - `Money = bigint`  → satuan sen IDR (jadi Rp 1 = 1n, Rp 1.000 = 1000n).
 *   - Serialisasi ke Postgres `numeric(18,2)` via `.toString()`.
 *   - Deserialisasi dari Postgres via `parseMoneyFromDb(row.amount)`.
 *   - Display via `formatIDR(money)`.
 *
 * NEVER cast Money to `number` untuk kalkulasi — hanya untuk display via
 * helper di file ini.
 */

/** Nilai uang IDR sebagai bigint (rupiah utuh, no fractional). */
export type Money = bigint;

// ---------------------------------------------------------------------------
// Parsing.
// ---------------------------------------------------------------------------

/**
 * Parse nilai `numeric` dari Postgres (dikirim sebagai string oleh Supabase)
 * ke `Money`. Postgres `numeric(18,2)` untuk IDR selalu punya "0.00" karena
 * IDR tidak punya sub-rupiah — kami buang bagian desimalnya.
 */
export function parseMoneyFromDb(value: string | number | null): Money {
  if (value === null || value === undefined) return 0n;
  const s = typeof value === "number" ? value.toString() : value;
  const [whole] = s.split(".");
  const cleaned = whole.replace(/[^\d-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0n;
  return BigInt(cleaned);
}

/**
 * Parse string yang diinput user (mis. "Rp 1.500.000" atau "1500000")
 * ke `Money`. Menerima titik / koma sebagai thousand separator.
 */
export function parseMoneyFromInput(input: string): Money {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  const digits = trimmed.replace(/[^\d-]/g, "");
  if (digits === "" || digits === "-") {
    throw new Error(`Nilai uang tidak valid: "${input}"`);
  }
  return BigInt(digits);
}

// ---------------------------------------------------------------------------
// Arithmetic — safe over bigint.
// ---------------------------------------------------------------------------

export function addMoney(...values: Money[]): Money {
  return values.reduce((acc, v) => acc + v, 0n);
}

export function subMoney(a: Money, b: Money): Money {
  return a - b;
}

/** Kalikan Money dengan integer. Untuk persentase gunakan `applyBasisPoints`. */
export function mulMoney(a: Money, factor: bigint | number): Money {
  const f = typeof factor === "number" ? BigInt(Math.round(factor)) : factor;
  return a * f;
}

/**
 * Terapkan basis point (1 bp = 0.01%) untuk perhitungan persentase yang
 * tetap presisi. Contoh: PPN 11% → 1100 bp.
 */
export function applyBasisPoints(money: Money, basisPoints: bigint | number): Money {
  const bp =
    typeof basisPoints === "number" ? BigInt(basisPoints) : basisPoints;
  return (money * bp) / 10000n;
}

// ---------------------------------------------------------------------------
// Serialization for Postgres numeric(18,2).
// ---------------------------------------------------------------------------

export function moneyToDbString(value: Money): string {
  return `${value.toString()}.00`;
}

// ---------------------------------------------------------------------------
// Display.
// ---------------------------------------------------------------------------

export type FormatIDROptions = {
  /** Include "Rp" prefix. Default true. */
  withSymbol?: boolean;
  /** Force compact notation for large numbers ("Rp 1,5 M"). Default false. */
  compact?: boolean;
};

const FORMATTER_CACHE = new Map<string, Intl.NumberFormat>();

function getFormatter(compact: boolean, withSymbol: boolean): Intl.NumberFormat {
  const key = `${compact}-${withSymbol}`;
  let f = FORMATTER_CACHE.get(key);
  if (f) return f;
  f = new Intl.NumberFormat("id-ID", {
    style: withSymbol ? "currency" : "decimal",
    currency: "IDR",
    currencyDisplay: "symbol",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard",
    compactDisplay: "short",
  });
  FORMATTER_CACHE.set(key, f);
  return f;
}

export function formatIDR(
  value: Money | number,
  options: FormatIDROptions = {},
): string {
  const { withSymbol = true, compact = false } = options;
  const n = typeof value === "bigint" ? Number(value) : value;
  return getFormatter(compact, withSymbol).format(n);
}

/**
 * Range-form untuk chart tooltip atau summary card (mis. `Rp 5jt – 25jt`).
 */
export function formatIDRRange(min: Money, max: Money): string {
  return `${formatIDR(min, { compact: true })} – ${formatIDR(max, {
    compact: true,
  })}`;
}
