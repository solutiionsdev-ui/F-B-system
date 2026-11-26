import { describe, expect, it } from "vitest";
import { endOfBusinessDate, pickRateForDate } from "@/lib/rates";

describe("endOfBusinessDate", () => {
  it("follows Beirut's winter and summer offsets", () => {
    // November: UTC+2. July: UTC+3 (daylight saving).
    expect(endOfBusinessDate("2026-11-21", "Asia/Beirut").toISOString()).toBe("2026-11-21T21:59:59.999Z");
    expect(endOfBusinessDate("2026-07-15", "Asia/Beirut").toISOString()).toBe("2026-07-15T20:59:59.999Z");
  });
});

describe("pickRateForDate", () => {
  const at = (iso: string) => new Date(iso);
  const rates = [
    { id: "a", effectiveAt: at("2026-10-31T22:00:00Z"), createdAt: at("2026-10-31T22:00:00Z") },
    // Set at 00:30 Beirut on 1 July (21:30 UTC on 30 June): belongs to 1 July, not 30 June.
    { id: "b", effectiveAt: at("2027-06-30T21:30:00Z"), createdAt: at("2027-06-30T21:30:00Z") },
  ];
  const now = at("2027-07-10T12:00:00Z");

  it("takes the rate in force at the end of the venue's own date", () => {
    expect(pickRateForDate(rates, "2027-06-30", "Asia/Beirut", now)?.rate.id).toBe("a");
    expect(pickRateForDate(rates, "2027-07-01", "Asia/Beirut", now)?.rate.id).toBe("b");
  });

  it("uses the current rate for today and future dates, never one set later", () => {
    expect(pickRateForDate(rates, "2027-07-10", "Asia/Beirut", now)?.rate.id).toBe("b");
    expect(pickRateForDate(rates, "2027-07-10", "Asia/Beirut", at("2027-06-30T12:00:00Z"))?.rate.id).toBe("a");
  });

  it("falls back to the earliest rate, and says so, before any rate existed", () => {
    expect(pickRateForDate(rates, "2026-09-01", "Asia/Beirut", now)).toEqual({ rate: rates[0], fallback: true });
    expect(pickRateForDate([], "2026-09-01", "Asia/Beirut", now)).toBeNull();
  });
});
