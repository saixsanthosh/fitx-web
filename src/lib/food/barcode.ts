/**
 * Retail barcodes FITX looks up: EAN-13, EAN-8, UPC-A and UPC-E (and GTIN-14 typed by hand). Every one ends
 * in a check digit, so a misread or mistyped number is caught before it costs an Open Food Facts request.
 */

export type BarcodeCheck =
  | { ok: true; code: string; format: "EAN-13" | "EAN-8" | "UPC-A" | "UPC-E" | "GTIN-14" }
  | { ok: false; reason: "empty" | "length" | "check-digit" };

/** Validates and normalises a barcode. UPC-E (8 digits starting with 0 or 1) is expanded to its UPC-A number. */
export function checkBarcode(input: string | null | undefined): BarcodeCheck {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, reason: "empty" };
  if (digits.length === 8) {
    if (gtinValid(digits)) return { ok: true, code: digits, format: "EAN-8" };
    const upcA = expandUpcE(digits);
    if (upcA && gtinValid(upcA)) return { ok: true, code: upcA, format: "UPC-E" };
    return { ok: false, reason: "check-digit" };
  }
  if (digits.length === 12) return gtinValid(digits) ? { ok: true, code: digits, format: "UPC-A" } : { ok: false, reason: "check-digit" };
  if (digits.length === 13) return gtinValid(digits) ? { ok: true, code: digits, format: "EAN-13" } : { ok: false, reason: "check-digit" };
  if (digits.length === 14) return gtinValid(digits) ? { ok: true, code: digits, format: "GTIN-14" } : { ok: false, reason: "check-digit" };
  return { ok: false, reason: "length" };
}

/** GS1 mod-10: weights 3 and 1 alternate from the digit next to the check digit. */
export function gtinValid(digits: string): boolean {
  if (!/^\d{8,14}$/.test(digits)) return false;
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) sum += Number(digits[index]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** UPC-E "0ABCDEFC" (number system, six digits, check) to UPC-A, or null when it is not UPC-E. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const system = code[0];
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7);
  const check = code[7];
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${system}${body}${check}`;
}

export function barcodeProblem(reason: Extract<BarcodeCheck, { ok: false }>["reason"]): string {
  if (reason === "empty") return "Enter the barcode number printed under the bars.";
  if (reason === "length") return "Product barcodes have 8, 12 or 13 digits. Check the number and try again.";
  return "That barcode's last digit doesn't match the rest, so it was misread or mistyped. Scan again or check the number.";
}
