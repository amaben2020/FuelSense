// Reads a photographed vehicle licence into the fields a manager would
// otherwise type.
//
// The paper a Nigerian state's Vehicle Inspection Office issues has two
// halves: a plain stub on the left ("Owner's Name:", "Registration Number:",
// one value per line) and a patterned sticker on the right where the same
// facts repeat over guilloche print. OCR reads the stub almost perfectly and
// the sticker badly, so the parser trusts labelled values in order of first
// appearance — the stub comes first — and falls back to the sticker only for
// what the stub does not carry: the expiry date and the issuing state.
import { extractTextWithOcrSpace, normalizeDataUrl, MAX_RECEIPT_UPLOAD_BYTES } from './receipt-ocr';

export interface VioCertificateFields {
  owner_name: string | null;
  owner_address: string | null;
  file_number: string | null;
  registration_number: string | null;
  engine_number: string | null;
  chassis_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  issuing_state: string | null;
  /** ISO date (YYYY-MM-DD) or null. */
  issued_on: string | null;
  expires_on: string | null;
  /** How the expiry was arrived at, so the form can say "check this". */
  expires_on_source: 'printed' | 'sticker' | 'issued_plus_year' | null;
}

const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa',
  'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger',
  'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe',
  'Zamfara', 'FCT', 'Abuja',
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
};

/** Nigerian papers print day first: 03/12/2025 is 3 December, not 12 March.
 *  The `03/Dec/2025` form the sticker uses is unambiguous. */
function parseDate(raw: string): string | null {
  const numeric = raw.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const named = raw.match(/(\d{1,2})[\/\s-]([A-Za-z]{3})[a-z]*[\/\s-](\d{4})/);
  if (named) {
    const m = MONTHS[named[2].toLowerCase()];
    if (m) return iso(Number(named[3]), m, Number(named[1]));
  }
  return null;
}

const clean = (v: string): string => v.replace(/[^\S\n]+/g, ' ').replace(/^[\s:.-]+|[\s:.-]+$/g, '').trim();

/**
 * The value that follows a label. The stub puts it on the next line; the
 * sticker puts it on the same line after a colon. Both are tried, first
 * match wins, and a value that is itself a label ("Address:") is rejected so
 * an empty field does not swallow the next one's caption.
 */
function labelled(lines: string[], pattern: RegExp, opts: { multiline?: boolean } = {}): string | null {
  const isLabel = (l: string) => /^[A-Za-z'’ ]{3,30}:?\s*$/.test(l) && /(name|address|number|make|model|fee|date|colou?r|capacity|type)/i.test(l);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(pattern);
    if (!m) continue;
    const inline = clean(lines[i].slice(m.index! + m[0].length));
    if (inline && !isLabel(inline)) return inline;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = clean(lines[j]);
      if (!next || isLabel(next) || /^REMOVE THIS/i.test(next)) break;
      out.push(next);
      if (!opts.multiline) break;
    }
    if (out.length) return out.join(', ');
  }
  return null;
}

const upperOrNull = (v: string | null): string | null => (v ? v.toUpperCase() : null);

/** "NA" and its OCR cousins mean the field was left blank on the paper. */
const blankIfNa = (v: string | null): string | null =>
  v && /^(n\/?a|nil|none|-+)$/i.test(v) ? null : v;

/** A registration number reads like ABC782PA; OCR occasionally swaps a digit
 *  for a letter of similar shape. Only the clean form is accepted. */
const asPlate = (v: string | null): string | null => {
  if (!v) return null;
  const m = v.toUpperCase().replace(/\s+/g, '').match(/[A-Z]{2,3}\d{2,3}[A-Z]{2,3}/);
  return m ? m[0] : null;
};

export function parseVioCertificateText(text: string): VioCertificateFields {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flat = lines.join('\n');

  const ownerName = labelled(lines, /owner'?s?\s*name/i);
  const ownerAddress = labelled(lines, /^address/i, { multiline: true });
  const fileNumber = labelled(lines, /file\s*(number|no)/i);
  const registration = asPlate(labelled(lines, /reg(istration)?\.?\s*(number|no)/i));
  const engine = blankIfNa(upperOrNull(labelled(lines, /engine\s*(number|no)/i)));
  const chassis = upperOrNull(labelled(lines, /chassis\s*(number|no)/i));
  const make = labelled(lines, /vehicle\s*mak[ea]/i);
  const model = labelled(lines, /(vehicle\s*)?model\b/i);
  const vehicleType = flat.match(/\b(private|commercial|government)\s+(car|vehicle|bus|truck)\b/i)?.[0] ?? null;

  const stateMatch = flat.match(new RegExp(`\\b(${NIGERIAN_STATES.join('|')})\\s+STATE`, 'i'));
  const issuingState = stateMatch
    ? NIGERIAN_STATES.find((st) => st.toLowerCase() === stateMatch[1].toLowerCase()) ?? stateMatch[1]
    : null;

  // Captioned dates first. The stub's bare "Date:" is the issue date, and
  // it comes before anything on the sticker, so first match wins there too.
  const issuedRaw =
    labelled(lines, /(date\s*issued|issued\s*on|transaction\s*date)/i) ??
    labelled(lines, /^date\b/i);
  const expiryRaw = labelled(lines, /expir/i);

  let issuedOn = issuedRaw ? parseDate(issuedRaw) : null;
  let expiresOn = expiryRaw ? parseDate(expiryRaw) : null;
  let source: VioCertificateFields['expires_on_source'] = expiresOn ? 'printed' : null;

  // Every date on the page, in reading order, for when OCR has kept the
  // digits but lost the caption.
  const dated = lines
    .map((l) => ({ line: l, date: parseDate(l) }))
    .filter((d): d is { line: string; date: string } => d.date != null);

  // No captioned expiry: the latest date on the page is it, provided it is
  // after the issue date. The big "DEC 2026" sticker month is the tiebreak —
  // a lone date in that month is the expiry, whatever caption OCR gave it.
  if (!expiresOn && dated.length) {
    const sticker = flat.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*[,']?\s*(20\d{2})\b/i);
    const latest = dated.map((d) => d.date).sort().at(-1)!;
    const inStickerMonth = sticker
      ? dated.find((d) => d.date.startsWith(`${sticker[2]}-${String(MONTHS[sticker[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}`))
      : undefined;
    const candidate = inStickerMonth?.date ?? latest;
    if (!issuedOn || candidate > issuedOn) {
      expiresOn = candidate;
      source = 'sticker';
    }
  }
  if (!issuedOn && dated.length) {
    const earliest = dated.map((d) => d.date).sort()[0];
    if (earliest !== expiresOn) issuedOn = earliest;
  }
  // A licence runs twelve months. With only an issue date to go on, that is
  // a better guess than blank, and the form says it was a guess.
  if (!expiresOn && issuedOn) {
    const d = new Date(`${issuedOn}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    expiresOn = d.toISOString().slice(0, 10);
    source = 'issued_plus_year';
  }

  return {
    owner_name: upperOrNull(ownerName),
    owner_address: upperOrNull(ownerAddress),
    file_number: fileNumber?.replace(/\D/g, '') || null,
    registration_number: registration,
    engine_number: engine,
    chassis_number: chassis,
    vehicle_make: make ? make.replace(/[,.]$/, '') : null,
    vehicle_model: blankIfNa(model ? model.replace(/[,.]$/, '') : null),
    vehicle_type: vehicleType ? vehicleType.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null,
    issuing_state: issuingState,
    issued_on: issuedOn,
    expires_on: expiresOn,
    expires_on_source: source,
  };
}

export interface VioScanResult {
  fields: VioCertificateFields;
  ocr_text: string;
  provider: string;
}

export async function scanVioCertificate(imageDataUrl: string): Promise<VioScanResult> {
  const { dataUrl, byteLength } = normalizeDataUrl(imageDataUrl);
  if (byteLength > MAX_RECEIPT_UPLOAD_BYTES) {
    throw Object.assign(
      new Error(
        `Certificate image is too large (${(byteLength / (1024 * 1024)).toFixed(1)} MB). ` +
          `Retake it, or crop to just the paper.`
      ),
      { status: 400 }
    );
  }
  const ocr = await extractTextWithOcrSpace(dataUrl);
  return { fields: parseVioCertificateText(ocr.ocr_text), ocr_text: ocr.ocr_text, provider: ocr.provider };
}
