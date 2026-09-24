/**
 * Reading a device's label from a photo: serial number and MAC address.
 *
 * Two ways, tried in this order:
 *   1. the phone's own barcode reader (BarcodeDetector, in Chrome on Android): most router, ONU and
 *      CPE labels carry a barcode or QR of the serial or MAC, and this is instant, exact and offline;
 *   2. text recognition of the printed label (Tesseract, loaded on first use), which needs a signal
 *      the first time and is less exact, so what it finds is always shown to be corrected.
 * Neither is trusted blindly: the technician confirms the values, and the photo is kept as proof.
 */

const MAC_SEPARATED = /(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}/g;
const MAC_LABELLED = /MAC(?:\s*(?:ADDRESS|ADDR|ID))?\s*[:#.]?\s*([0-9A-F]{12})\b/g;
const SERIAL_LABELLED = /(?:S\/N|SN|SERIAL(?:\s*(?:NO|NUMBER|NUM))?)\s*[:#.]?\s*([A-Z0-9-]{6,24})/g;
const SERIAL_LIKE = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{8,20}\b/g;

const upperMac = (m) => m.replace(/-/g, ':').toUpperCase();
const twelve = (m) => m.replace(/[^0-9A-F]/gi, '').toUpperCase();

/** Pull serial and MAC candidates out of any text (a decoded barcode, or OCR output). */
export function absorb(text, found) {
  const t = String(text ?? '').toUpperCase();
  for (const m of t.matchAll(MAC_SEPARATED)) found.macs.add(upperMac(m[0]));
  for (const m of t.matchAll(MAC_LABELLED)) found.macs.add(upperMac(m[1].match(/.{2}/g).join(':')));
  for (const m of t.matchAll(SERIAL_LABELLED)) found.serials.add(m[1]);
  // A bare barcode value (no label): a 12-digit hex string is most likely the MAC, anything else alphanumeric the serial.
  const bare = t.trim();
  if (/^[0-9A-F]{12}$/.test(bare)) found.macs.add(upperMac(bare.match(/.{2}/g).join(':')));
  else if (/^[A-Z0-9-]{6,24}$/.test(bare) && !found.serials.size) found.serials.add(bare);
  if (!found.serials.size) {
    for (const m of t.matchAll(SERIAL_LIKE)) {
      if (!found.macs.has(upperMac(m[0])) && twelve(m[0]).length !== 12) found.serials.add(m[0]);
    }
  }
}

let ocrModule = null;
async function ocr(file) {
  if (!ocrModule) {
    ocrModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js');
  }
  const T = ocrModule.default ?? ocrModule;
  const { data } = await T.recognize(file, 'eng');
  return data.text;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** { serials: [...], macs: [...], how: 'barcode' | 'text' | 'none' } */
export async function scanLabel(file) {
  const found = { serials: new Set(), macs: new Set() };
  let how = 'none';

  if ('BarcodeDetector' in window) {
    try {
      const bmp = await createImageBitmap(file);
      const codes = await new window.BarcodeDetector().detect(bmp);
      for (const c of codes) absorb(c.rawValue, found);
      if (found.serials.size || found.macs.size) how = 'barcode';
    } catch { /* fall through to reading the text */ }
  }

  if (how === 'none') {
    try {
      if (navigator.onLine === false) throw new Error('offline');   // the text reader is downloaded on first use
      absorb(await withTimeout(ocr(file), 20000), found);
      if (found.serials.size || found.macs.size) how = 'text';
    } catch { /* no signal for the reader, or it could not read it: the technician types it */ }
  }
  return { serials: [...found.serials].slice(0, 5), macs: [...found.macs].slice(0, 3), how };
}
