// The chart spec FuelBrain writes inside a ```chart block, and its validator.
// No imports on purpose: the backend's test suite checks it too, and the eval
// harness uses it to grade the charts the model actually produced.
export interface ChartSpec {
  type: 'bar' | 'line';
  title?: string;
  unit?: string;
  x: string[];
  series: Array<{ name: string; values: Array<number | null> }>;
}

const MAX_SERIES = 6;
const MAX_POINTS = 31;

/**
 * The model writes the spec, so it is checked rather than trusted: anything
 * malformed returns the reason and the chat shows the raw block instead of a
 * misleading picture.
 */
export function parseChartSpec(source: string): { spec: ChartSpec } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return { error: 'The chart data is not valid JSON.' };
  }
  const s = raw as Partial<ChartSpec>;
  if (s.type !== 'bar' && s.type !== 'line') return { error: 'Unknown chart type.' };
  if (!Array.isArray(s.x) || s.x.length === 0 || s.x.length > MAX_POINTS) {
    return { error: `A chart needs 1 to ${MAX_POINTS} x labels.` };
  }
  if (!Array.isArray(s.series) || s.series.length === 0 || s.series.length > MAX_SERIES) {
    return { error: `A chart needs 1 to ${MAX_SERIES} series.` };
  }
  for (const series of s.series) {
    if (typeof series?.name !== 'string' || !Array.isArray(series.values)) {
      return { error: 'Each series needs a name and values.' };
    }
    if (series.values.length !== s.x.length) {
      return { error: `"${series.name}" has ${series.values.length} values for ${s.x.length} labels.` };
    }
    if (series.values.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) {
      return { error: `"${series.name}" contains a value that is not a number.` };
    }
  }
  return {
    spec: {
      type: s.type,
      title: typeof s.title === 'string' ? s.title : undefined,
      unit: typeof s.unit === 'string' ? s.unit : undefined,
      x: s.x.map(String),
      series: s.series,
    },
  };
}
