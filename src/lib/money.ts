// USD/LBP money engine. All amounts are bigint minor units (USD cents, whole
// LBP) and rates are bigint LBP-per-USD scaled by RATE_SCALE. No floating
// point anywhere, so 4,475,000 LBP at 89,500 is exactly $50.00 every time.

export type Currency = "USD" | "LBP";
export const CURRENCIES: readonly Currency[] = ["USD", "LBP"] as const;

export const MINOR_DIGITS: Record<Currency, number> = { USD: 2, LBP: 0 };
const MINOR_FACTOR: Record<Currency, bigint> = { USD: 100n, LBP: 1n };

/** Rates keep 4 decimal places, matching numeric(14,4) in the database. */
export const RATE_DECIMALS = 4;
export const RATE_SCALE = 10_000n;

/** Notes counted at closing, largest first. */
export const DENOMINATIONS: Record<Currency, number[]> = {
  USD: [100, 50, 20, 10, 5, 1],
  LBP: [100_000, 50_000, 20_000, 10_000, 5_000, 1_000],
};

const MAX_MINOR = 10n ** 15n;

export class MoneyError extends Error {}

export type Pair = Record<Currency, bigint>;
export const zeroPair = (): Pair => ({ USD: 0n, LBP: 0n });

/** Integer division rounding half away from zero. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new MoneyError("Division by zero");
  const negative = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return negative ? -q : q;
}

/**
 * Parses a plain decimal string ("1,250.5", "4.5m", "250k") into an integer
 * scaled by 10^decimals. Rejects input that would need more precision.
 */
function parseScaled(input: string, decimals: number, label: string): bigint {
  const clean = input.trim().replace(/[\s,_]/g, "").toLowerCase();
  if (clean === "") throw new MoneyError(`Enter the ${label}`);
  const m = /^(\d*)(?:\.(\d*))?([km])?$/.exec(clean);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) {
    throw new MoneyError(`"${input.trim()}" isn't a valid ${label}`);
  }
  const intPart = m[1] || "0";
  const frac = m[2] ?? "";
  const shift = m[3] === "k" ? 3 : m[3] === "m" ? 6 : 0;
  // digits * 10^-frac.length * 10^shift, expressed at 10^decimals
  const digits = BigInt(intPart + frac);
  const exp = decimals + shift - frac.length;
  if (exp >= 0) return digits * 10n ** BigInt(exp);
  const divisor = 10n ** BigInt(-exp);
  if (digits % divisor !== 0n) {
    throw new MoneyError(
      decimals === 0
        ? `The ${label} must be a whole number`
        : `The ${label} can have at most ${decimals} decimal places`,
    );
  }
  return digits / divisor;
}

/** Parses what a person typed into minor units. Throws MoneyError on bad input. */
export function parseAmount(input: string, currency: Currency): bigint {
  const label = `${currency} amount`;
  const value = parseScaled(input.replace(/^\$|usd|lbp|l\.?l\.?$/gi, ""), MINOR_DIGITS[currency], label);
  if (value > MAX_MINOR) throw new MoneyError("Amount is too large");
  return value;
}

/** Like parseAmount but treats an empty field as zero. */
export function parseOptionalAmount(input: string | null | undefined, currency: Currency): bigint {
  if (input == null || input.trim() === "") return 0n;
  return parseAmount(input, currency);
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "$1,250.50", "LBP 4,500,000", "−$3.00". */
export function formatAmount(minor: bigint, currency: Currency, opts: { signed?: boolean } = {}): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const factor = MINOR_FACTOR[currency];
  const whole = group((abs / factor).toString());
  const body =
    currency === "USD" ? `$${whole}.${(abs % factor).toString().padStart(2, "0")}` : `LBP ${whole}`;
  if (negative) return `−${body}`;
  if (opts.signed && abs !== 0n) return `+${body}`;
  return body;
}

/** Plain number string suitable as a form input value ("1250.50", "4500000"). */
export function toInputValue(minor: bigint, currency: Currency): string {
  const factor = MINOR_FACTOR[currency];
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  if (currency === "LBP") return `${sign}${abs}`;
  return `${sign}${abs / factor}.${(abs % factor).toString().padStart(2, "0")}`;
}

/** Parses an LBP-per-USD rate ("89,500" or the database's "89500.0000"). */
export function parseRate(input: string): bigint {
  const rate = parseScaled(input, RATE_DECIMALS, "rate");
  if (rate <= 0n) throw new MoneyError("The rate must be greater than zero");
  return rate;
}

/** Database numeric string for a scaled rate. */
export function rateToDb(rate: bigint): string {
  return `${rate / RATE_SCALE}.${(rate % RATE_SCALE).toString().padStart(RATE_DECIMALS, "0")}`;
}

/** "89,500" or "89,500.25". */
export function formatRate(rate: bigint): string {
  const whole = group((rate / RATE_SCALE).toString());
  const frac = (rate % RATE_SCALE).toString().padStart(RATE_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Converts between currencies at a rate, rounding half away from zero to the target's minor unit. */
export function convert(minor: bigint, from: Currency, to: Currency, rate: bigint): bigint {
  if (rate <= 0n) throw new MoneyError("The rate must be greater than zero");
  if (from === to) return minor;
  if (from === "LBP") {
    // LBP -> USD cents: lbp * 100 / (rate / SCALE)
    return divRound(minor * MINOR_FACTOR.USD * RATE_SCALE, rate);
  }
  // USD cents -> LBP: cents / 100 * (rate / SCALE)
  return divRound(minor * rate, MINOR_FACTOR.USD * RATE_SCALE);
}

/** USD-equivalent (in cents) of a USD + LBP pair at one rate. */
export function usdEquivalent(pair: Pair, rate: bigint): bigint {
  return pair.USD + convert(pair.LBP, "LBP", "USD", rate);
}

/** Total of a denomination count: { "100": 3, "20": 2 } -> minor units. */
export function countTotal(
  counts: Record<string, number>,
  currency: Currency,
  looseMinor: bigint = 0n,
): bigint {
  let total = looseMinor;
  for (const [note, qty] of Object.entries(counts)) {
    if (!DENOMINATIONS[currency].includes(Number(note))) {
      throw new MoneyError(`${note} is not a ${currency} note we count`);
    }
    if (!Number.isInteger(qty) || qty < 0) throw new MoneyError(`Note counts must be whole numbers`);
    total += BigInt(note) * MINOR_FACTOR[currency] * BigInt(qty);
  }
  return total;
}
