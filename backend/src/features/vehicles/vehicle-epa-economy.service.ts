// EPA city fuel economy, per model year, for the catalogue models sold in the
// United States.
//
// The fleet's reference figure for a vehicle is its real-world CITY rating,
// not a combined or highway one: these vehicles spend their lives in stop-start
// traffic. Source: fueleconomy.gov `vehicles.csv` (downloaded 2026-09-28),
// taking for each model year the best `city08` among petrol, non-hybrid,
// two-wheel-drive versions — the base engine, which is what fleets buy. Where a
// year only came in AWD/4WD, that figure is used.
//
// Models sold in the US under another name map onto it only for the years the
// two are the same car (commented `// EPA '<name>'`). Models the EPA never
// rated (Hiace, Hilux, Prado, trucks, buses) are absent and keep the
// catalogue's own city figure.
//
// Ratings are US gallons. A manager who types the vehicle's own dashboard
// figure at onboarding overrides this.

/** [firstYear, lastYear, cityMpgUs] */
type MpgRange = [number, number, number];

const EPA_CITY_MPG: Record<string, MpgRange[]> = {
  'Toyota|Corolla': [[2000, 2000, 27], [2001, 2008, 28], [2009, 2009, 27], [2010, 2010, 26], [2011, 2013, 27], [2014, 2018, 30], [2019, 2027, 32]],
  'Toyota|Camry': [[2000, 2006, 21], [2007, 2008, 22], [2009, 2009, 21], [2010, 2011, 22], [2012, 2012, 24], [2013, 2016, 25], [2017, 2017, 24], [2018, 2020, 29], [2021, 2024, 28]],
  'Toyota|RAV4': [[2000, 2000, 21], [2001, 2003, 22], [2004, 2008, 21], [2009, 2010, 22], [2011, 2012, 21], [2013, 2018, 23], [2019, 2019, 26], [2020, 2021, 28], [2022, 2025, 27]],
  'Toyota|Land Cruiser': [[2000, 2007, 12], [2008, 2011, 13], [2013, 2021, 13]],
  'Toyota|Highlander': [[2001, 2007, 19], [2008, 2008, 18], [2009, 2016, 20], [2017, 2022, 21], [2023, 2025, 22], [2026, 2026, 21]],
  'Toyota|Sienna': [[2000, 2000, 16], [2001, 2010, 17], [2011, 2013, 19], [2014, 2016, 18], [2017, 2020, 19]],
  'Kia|Rio': [[2001, 2001, 24], [2002, 2004, 23], [2005, 2005, 22], [2006, 2009, 27], [2010, 2011, 28], [2012, 2012, 29], [2013, 2013, 30], [2014, 2017, 27], [2018, 2019, 29], [2020, 2022, 33], [2023, 2023, 32]],
  'Kia|Optima': [[2001, 2002, 19], [2003, 2005, 20], [2006, 2008, 21], [2009, 2010, 22], [2011, 2013, 24], [2014, 2015, 23], [2016, 2018, 28], [2019, 2020, 27]],
  'Kia|Sportage': [[2000, 2001, 18], [2002, 2002, 17], [2005, 2010, 20], [2011, 2011, 22], [2012, 2016, 21], [2017, 2022, 23], [2023, 2027, 25]],
  'Kia|Sorento': [[2003, 2004, 14], [2005, 2006, 15], [2007, 2009, 16], [2011, 2013, 21], [2014, 2015, 20], [2016, 2018, 21], [2019, 2020, 22], [2021, 2023, 24], [2024, 2027, 23]],
  'Kia|Cerato': [[2010, 2013, 27], [2014, 2016, 26], [2017, 2018, 29], [2019, 2022, 31], [2023, 2024, 30]], // EPA 'Forte'
  'Hyundai|Elantra': [[2000, 2002, 21], [2003, 2003, 22], [2004, 2004, 24], [2005, 2006, 23], [2007, 2009, 25], [2010, 2010, 26], [2011, 2013, 28], [2014, 2015, 27], [2016, 2016, 28], [2017, 2019, 32], [2020, 2023, 33], [2024, 2025, 32], [2026, 2026, 31]],
  'Hyundai|Accent': [[2006, 2009, 27], [2010, 2010, 28], [2011, 2011, 27], [2012, 2013, 28], [2014, 2017, 27], [2018, 2019, 28], [2020, 2022, 33]],
  'Hyundai|Sonata': [[2000, 2001, 19], [2002, 2005, 20], [2006, 2008, 21], [2009, 2010, 22], [2011, 2014, 24], [2015, 2023, 28], [2024, 2024, 25], [2025, 2026, 28], [2027, 2027, 26]],
  'Hyundai|Tucson': [[2005, 2009, 20], [2010, 2011, 23], [2012, 2013, 22], [2014, 2015, 23], [2016, 2017, 26], [2018, 2018, 25], [2019, 2021, 23], [2022, 2022, 26], [2023, 2026, 25]],
  'Hyundai|Santa Fe': [[2001, 2001, 19], [2002, 2009, 18], [2010, 2012, 20], [2013, 2013, 21], [2014, 2016, 20], [2017, 2018, 21], [2019, 2020, 22], [2021, 2023, 25], [2024, 2027, 20]],
  'Ford|Ranger': [[2000, 2000, 20], [2001, 2009, 21], [2010, 2011, 22], [2019, 2026, 21]],
  'Ford|Explorer': [[2000, 2002, 16], [2003, 2003, 15], [2004, 2008, 14], [2009, 2010, 15], [2011, 2011, 18], [2012, 2015, 20], [2016, 2019, 19], [2020, 2024, 21], [2025, 2027, 20]],
  'Ford|Edge': [[2007, 2008, 16], [2009, 2009, 17], [2010, 2010, 18], [2011, 2011, 19], [2012, 2018, 21], [2019, 2019, 22], [2020, 2024, 21]],
  'Nissan|Almera': [[2012, 2012, 30], [2013, 2019, 31]], // EPA 'Versa'
  'Nissan|X-Trail': [[2014, 2014, 25], [2015, 2020, 26], [2021, 2025, 30], [2026, 2026, 29]], // EPA 'Rogue'
  'Nissan|Patrol': [[2017, 2024, 14], [2025, 2026, 16]], // EPA 'Armada'
  'Honda|Accord': [[2000, 2002, 22], [2003, 2007, 23], [2008, 2010, 22], [2011, 2012, 23], [2013, 2014, 26], [2015, 2017, 27], [2018, 2022, 30], [2023, 2026, 29]],
  'Honda|Civic': [[2000, 2000, 30], [2001, 2005, 31], [2006, 2011, 26], [2012, 2012, 28], [2013, 2013, 29], [2014, 2016, 31], [2017, 2021, 32], [2022, 2024, 33], [2025, 2026, 32]],
  'Honda|CR-V': [[2000, 2009, 20], [2010, 2011, 21], [2012, 2014, 23], [2015, 2015, 27], [2016, 2016, 26], [2017, 2027, 28]],
  'Honda|Pilot': [[2003, 2005, 15], [2006, 2008, 16], [2009, 2011, 17], [2012, 2015, 18], [2016, 2022, 20], [2023, 2026, 19]],
  'Volkswagen|Passat': [[2000, 2000, 21], [2001, 2001, 20], [2002, 2005, 19], [2006, 2007, 21], [2008, 2008, 20], [2009, 2009, 19], [2010, 2010, 22], [2012, 2013, 22], [2014, 2015, 24], [2016, 2016, 25], [2017, 2017, 23], [2018, 2019, 25], [2020, 2020, 23], [2021, 2022, 24]],
  'Mitsubishi|Pajero': [[2000, 2000, 15], [2001, 2001, 13], [2002, 2003, 14], [2004, 2006, 13]], // EPA 'Montero'
};

/** 1 US gallon = 3.785411784 L, 1 mile = 1.609344 km. */
const L100KM_PER_MPG_US = 235.214583;

const key = (make: string, model: string) => `${make.trim().toLowerCase()}|${model.trim().toLowerCase()}`;

const INDEX = new Map(Object.entries(EPA_CITY_MPG).map(([k, v]) => [k.toLowerCase(), v]));

/** EPA city mpg (US) for a make/model/year, or null when the EPA never rated it. */
export function epaCityMpg(
  make: string | null | undefined,
  model: string | null | undefined,
  year: number | null | undefined
): number | null {
  if (!make || !model || year == null) return null;
  const ranges = INDEX.get(key(make, model));
  return ranges?.find(([from, to]) => year >= from && year <= to)?.[2] ?? null;
}

/** Every rated year for a model, for the onboarding form to pre-fill from. */
export function epaCityMpgRanges(make: string, model: string): MpgRange[] {
  return INDEX.get(key(make, model)) ?? [];
}

export function mpgUsToL100km(mpg: number): number {
  return Math.round((L100KM_PER_MPG_US / mpg) * 100) / 100;
}
