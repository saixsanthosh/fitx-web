import { test } from "node:test";
import assert from "node:assert/strict";
import { barcodeProblem, checkBarcode, expandUpcE, gtinValid } from "@/lib/food/barcode";

test("accepts retail barcodes with a valid check digit", () => {
  assert.deepEqual(checkBarcode("5449000131805"), { ok: true, code: "5449000131805", format: "EAN-13" });
  assert.deepEqual(checkBarcode("8901063011366"), { ok: true, code: "8901063011366", format: "EAN-13" }, "an Indian (890) product code");
  assert.deepEqual(checkBarcode("96385074"), { ok: true, code: "96385074", format: "EAN-8" });
  assert.deepEqual(checkBarcode("036000291452"), { ok: true, code: "036000291452", format: "UPC-A" });
  assert.deepEqual(checkBarcode(" 5449000 131805 "), { ok: true, code: "5449000131805", format: "EAN-13" }, "spaces are ignored");
});

test("expands UPC-E to the UPC-A number Open Food Facts stores", () => {
  assert.equal(expandUpcE("04252614"), "042100005264");
  assert.deepEqual(checkBarcode("04252614"), { ok: true, code: "042100005264", format: "UPC-E" });
  assert.equal(expandUpcE("12345678")?.length, 12);
  assert.equal(expandUpcE("92345678"), null, "UPC-E starts with 0 or 1");
});

test("rejects misreads and typos before any lookup", () => {
  assert.deepEqual(checkBarcode("5449000131806"), { ok: false, reason: "check-digit" });
  assert.deepEqual(checkBarcode("12345"), { ok: false, reason: "length" });
  assert.deepEqual(checkBarcode(""), { ok: false, reason: "empty" });
  assert.deepEqual(checkBarcode(null), { ok: false, reason: "empty" });
  assert.equal(gtinValid("abc"), false);
  assert.match(barcodeProblem("check-digit"), /misread or mistyped/);
  assert.match(barcodeProblem("length"), /8, 12 or 13 digits/);
});

test("an 8-digit code read as UPC-E is looked up as its UPC-A number", () => {
  assert.deepEqual(checkBarcode("01234565"), { ok: true, code: "012345000065", format: "UPC-E" }, "valid both ways, but retail EAN-8 never starts with 0");
  assert.deepEqual(checkBarcode("01234565", "ean_8"), { ok: true, code: "01234565", format: "EAN-8" }, "unless the scanner read EAN-8");
  assert.deepEqual(checkBarcode("12345670"), { ok: true, code: "12345670", format: "EAN-8" });
  assert.deepEqual(checkBarcode("12345670", "upc_e"), { ok: true, code: "123456000070", format: "UPC-E" }, "the BarcodeDetector format");
  assert.deepEqual(checkBarcode("12345670", "UPC_E"), { ok: true, code: "123456000070", format: "UPC-E" }, "the ZXing format name");
  assert.deepEqual(checkBarcode("96385074", "upc_e"), { ok: true, code: "96385074", format: "EAN-8" }, "a code that can't be UPC-E stays EAN-8");
});
