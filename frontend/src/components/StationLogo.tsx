/**
 * The filling-station brand mark for a merchant name.
 *
 * Receipts carry whatever the driver typed or the autocomplete returned —
 * "AA Rano, Ado", "TotalEnergies Lekki", "NNPC Mega Station" — so the brand
 * is found by looking for a known name anywhere in the string, longest match
 * first so "TotalEnergies" wins over a bare "Total". Marks come from the Blue
 * Pump station set in /public/stations; an unknown merchant renders nothing,
 * never a placeholder, so a name the fleet has never bought from stays plain.
 */

const STATIONS: Array<{ file: string; alt: string; match: RegExp }> = [
  { file: 'totalenergies.png', alt: 'TotalEnergies', match: /total\s*energies|\btotal\b/i },
  { file: 'nnpc.svg', alt: 'NNPC', match: /\bnnpc\b/i },
  { file: 'aarano.svg', alt: 'A.A. Rano', match: /\ba\.?\s?a\.?\s?rano\b|\brano\b/i },
  { file: 'shema.svg', alt: 'Shema', match: /\bshema\b/i },
  { file: 'conoil.svg', alt: 'Conoil', match: /\bconoil\b/i },
  { file: 'oando.svg', alt: 'Oando', match: /\boando\b/i },
  { file: 'mrs.svg', alt: 'MRS', match: /\bmrs\b/i },
  { file: 'ardova.svg', alt: 'Ardova', match: /\bardova\b|\bap\s+(filling|station|petrol)/i },
  { file: 'nipco.svg', alt: 'NIPCO', match: /\bnipco\b/i },
  { file: 'bovas.svg', alt: 'Bovas', match: /\bbovas\b/i },
  { file: 'rainoil.svg', alt: 'Rainoil', match: /\brain\s?oil\b/i },
  { file: 'shafa.svg', alt: 'Shafa', match: /\bshafa\b/i },
  { file: '11plc.svg', alt: '11 Plc', match: /\b11\s?plc\b|\bmobil\b/i },
];

export function stationFor(merchant: string | null | undefined) {
  if (!merchant) return null;
  return STATIONS.find((s) => s.match.test(merchant)) ?? null;
}

export function StationLogo({
  merchant,
  size = 20,
  className = '',
}: {
  merchant: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const station = stationFor(merchant);
  if (!station) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/stations/${station.file}`}
      alt={station.alt}
      title={station.alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-md bg-white object-contain p-[2px] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Merchant name with its brand mark in front, for table cells and lines. */
export function MerchantLabel({
  merchant,
  size = 20,
  className = '',
}: {
  merchant: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (!merchant) return <>—</>;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <StationLogo merchant={merchant} size={size} />
      <span>{merchant}</span>
    </span>
  );
}
