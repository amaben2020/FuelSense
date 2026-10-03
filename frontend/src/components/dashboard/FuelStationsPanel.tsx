'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, Map, Marker, useMap } from '@vis.gl/react-google-maps';
import { Fuel, History, Loader2, MapPin, Search, Trash2, X } from 'lucide-react';
import {
  FleetVehicle,
  FuelStation,
  FuelStationVisit,
  StationCandidate,
  StationSuggestion,
  fetchFuelStationVisits,
  fetchFuelStations,
  fetchNearbyStation,
  fetchStationPlace,
  placePhotoSrc,
  searchStations,
  unwatchFuelStation,
  watchFuelStation,
} from '@/lib/api';
import { FLEET_MAPS_KEY, LAGOS_CENTER, fleetMapDefaults } from '@/lib/fleet-map-theme';
import { useLightTheme } from '@/lib/use-light-theme';
import { parseServerTime } from '@/lib/map-utils';
import { MapResizeFix } from '@/components/maps/SharedMapLayers';
import { Panel, SegmentedPills, StatusChip } from '@/components/ui/chrome';
import { StationLogo, stationFor } from '@/components/StationLogo';

const RADIUS_CHOICES = [40, 60, 100, 150];
const PERIODS = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

type Point = { lat: number; lng: number };

/** A point clicked where Google knows no station — the manager names it. */
type Draft =
  | { kind: 'place'; place: StationCandidate }
  | { kind: 'custom'; point: Point };

// Raw timestamps arrive zone-less (UTC wall time); parseServerTime reads them as UTC.
const lagosTime = (value: string, withDate = true) =>
  (parseServerTime(value) ?? new Date(NaN)).toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    ...(withDate ? { day: 'numeric', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });

function dwellLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const STATUS_CHIP: Record<FuelStationVisit['status'], { tone: 'good' | 'accent' | 'neutral'; label: string }> = {
  stopped: { tone: 'good', label: 'Stopped' },
  on_site: { tone: 'accent', label: 'On site now' },
  passed: { tone: 'neutral', label: 'Drove past' },
};

function StationPhoto({
  url,
  name,
  className,
}: {
  url: string | null;
  name: string;
  className: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = placePhotoSrc(url);
  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center bg-panel-deep text-ink-dim ${className}`}>
        {stationFor(name) ? (
          <StationLogo merchant={name} size={40} />
        ) : (
          <Fuel className="h-6 w-6" aria-hidden />
        )}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

/** Pans the map whenever the focused point changes. */
function MapFocus({ target }: { target: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !target) return;
    map.panTo(target);
    if ((map.getZoom() ?? 0) < 16) map.setZoom(17);
  }, [map, target]);
  return null;
}

/** The zone each station is watched with, drawn to scale. */
function StationCircles({
  stations,
  selectedId,
}: {
  stations: FuelStation[];
  selectedId: string | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const circles = stations.map(
      (s) =>
        new google.maps.Circle({
          map,
          center: { lat: s.latitude, lng: s.longitude },
          radius: s.radius_m,
          strokeColor: '#dfa94a',
          strokeOpacity: 0.9,
          strokeWeight: s.id === selectedId ? 2.5 : 1.5,
          fillColor: '#dfa94a',
          fillOpacity: s.id === selectedId ? 0.22 : 0.1,
          clickable: false,
        })
    );
    return () => circles.forEach((c) => c.setMap(null));
  }, [map, stations, selectedId]);
  return null;
}

/** Everything the map can centre on before any station exists: the freshest fix. */
function freshestFix(fleet: FleetVehicle[]): Point | null {
  let best: { at: number; point: Point } | null = null;
  for (const v of fleet) {
    const lat = Number(v.latitude);
    const lng = Number(v.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    const at = new Date(v.last_gps_fix_at ?? v.last_telemetry_at ?? 0).getTime();
    if (!best || at > best.at) best = { at, point: { lat, lng } };
  }
  return best?.point ?? null;
}

export function FuelStationsPanel({
  fleet,
  readOnly = false,
}: {
  fleet: FleetVehicle[];
  readOnly?: boolean;
}) {
  const lightTheme = useLightTheme();
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [visits, setVisits] = useState<FuelStationVisit[]>([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const [loadingVisits, setLoadingVisits] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [period, setPeriod] = useState<PeriodId>('30');
  const [stationFilter, setStationFilter] = useState<string | null>(null);
  const [includePasses, setIncludePasses] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftName, setDraftName] = useState('');
  const [radius, setRadius] = useState(60);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [focus, setFocus] = useState<Point | null>(null);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<StationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  // Filling the box with a picked name must not search for it again.
  const skipNextSearch = useRef(false);

  const origin = useMemo(() => freshestFix(fleet), [fleet]);
  const initialCenter = useMemo(
    () =>
      stations[0] ? { lat: stations[0].latitude, lng: stations[0].longitude } : origin ?? LAGOS_CENTER,
    // Read once by <Map> on mount; later changes move the map through MapFocus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingStations]
  );

  const loadStations = useCallback(() => {
    setLoadingStations(true);
    return fetchFuelStations()
      .then((rows) => {
        setStations(rows);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingStations(false));
  }, []);

  const loadVisits = useCallback(() => {
    setLoadingVisits(true);
    return fetchFuelStationVisits({ days: Number(period), stationId: stationFilter, includePasses })
      .then((r) => setVisits(r.visits))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingVisits(false));
  }, [period, stationFilter, includePasses]);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  useEffect(() => {
    loadVisits();
  }, [loadVisits]);

  // Debounced search; a stale response never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      setSearching(true);
      searchStations(q, origin)
        .then((rows) => {
          if (seq === searchSeq.current) setSuggestions(rows);
        })
        .catch(() => {
          if (seq === searchSeq.current) setSuggestions([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, origin]);

  const selected = stations.find((s) => s.id === selectedId) ?? null;

  const pickSuggestion = async (s: StationSuggestion) => {
    setSuggestions([]);
    skipNextSearch.current = true;
    setQuery(s.name);
    setResolving(true);
    setSelectedId(null);
    try {
      const place = await fetchStationPlace(s.place_id);
      setDraft({ kind: 'place', place });
      setDraftName(place.name);
      setFocus({ lat: place.latitude, lng: place.longitude });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const pickPoint = async (point: Point) => {
    if (readOnly) return;
    setSelectedId(null);
    setResolving(true);
    try {
      const { station } = await fetchNearbyStation(point.lat, point.lng);
      if (station) {
        setDraft({ kind: 'place', place: station });
        setDraftName(station.name);
        setFocus({ lat: station.latitude, lng: station.longitude });
      } else {
        setDraft({ kind: 'custom', point });
        setDraftName('');
        setFocus(point);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolving(false);
    }
  };

  const selectStation = (s: FuelStation) => {
    setDraft(null);
    setSelectedId(s.id);
    setFocus({ lat: s.latitude, lng: s.longitude });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { id } =
        draft.kind === 'place'
          ? await watchFuelStation({ place_id: draft.place.place_id, name: draftName, radius_m: radius })
          : await watchFuelStation({
              name: draftName,
              latitude: draft.point.lat,
              longitude: draft.point.lng,
              radius_m: radius,
            });
      setDraft(null);
      setQuery('');
      await loadStations();
      setSelectedId(id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (s: FuelStation) => {
    if (!window.confirm(`Stop watching ${s.name}? Its visit log is deleted with it.`)) return;
    try {
      await unwatchFuelStation(s.id);
      if (selectedId === s.id) setSelectedId(null);
      if (stationFilter === s.id) setStationFilter(null);
      await Promise.all([loadStations(), loadVisits()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const draftPoint: Point | null = draft
    ? draft.kind === 'place'
      ? { lat: draft.place.latitude, lng: draft.place.longitude }
      : draft.point
    : null;

  const mapOptions = useMemo(
    () =>
      fleetMapDefaults(
        {
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        },
        true,
        lightTheme
      ),
    [lightTheme]
  );

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          icon={MapPin}
          title="Pick stations"
          subtitle={
            readOnly
              ? 'The stations this fleet watches'
              : 'Search by name, or click a forecourt on the map'
          }
          className="lg:col-span-3"
        >
          {!readOnly && (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="NNPC Wuse II, TotalEnergies Garki…"
                className="w-full rounded-full border border-edge bg-panel-deep py-2 pl-9 pr-9 text-sm text-ink placeholder:text-ink-dim focus:border-brand focus:outline-none"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-dim" />
              )}
              {suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-edge bg-panel shadow-lg">
                  {suggestions.map((s) => (
                    <li key={s.place_id}>
                      <button
                        type="button"
                        onClick={() => pickSuggestion(s)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-panel-hover"
                      >
                        {s.fuel_station ? (
                          <Fuel className="h-4 w-4 shrink-0 text-fuel-amber" />
                        ) : (
                          <MapPin className="h-4 w-4 shrink-0 text-ink-dim" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{s.name}</span>
                          <span className="block truncate text-xs text-ink-dim">{s.description}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="relative h-[420px] overflow-hidden rounded-xl border border-edge">
            {!loadingStations && (
              <APIProvider apiKey={FLEET_MAPS_KEY}>
                <Map
                  {...mapOptions}
                  defaultCenter={initialCenter}
                  defaultZoom={stations.length ? 14 : 13}
                  style={{ width: '100%', height: '100%' }}
                  onClick={(e) => {
                    if (e.detail.latLng) pickPoint(e.detail.latLng);
                  }}
                >
                  <MapResizeFix />
                  <MapFocus target={focus} />
                  <StationCircles stations={stations} selectedId={selectedId} />
                  {stations.map((s) => (
                    <Marker
                      key={s.id}
                      position={{ lat: s.latitude, lng: s.longitude }}
                      title={s.name}
                      onClick={() => selectStation(s)}
                    />
                  ))}
                  {draftPoint && <Marker position={draftPoint} title="New station" />}
                </Map>
              </APIProvider>
            )}
            {resolving && (
              <div className="absolute inset-x-0 top-2 flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full bg-panel px-3 py-1 text-xs text-ink-mid shadow">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking up the station…
                </span>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          icon={Fuel}
          title={draft ? 'New station' : selected ? selected.name : 'Station'}
          subtitle={
            draft
              ? 'Check the picture before you watch it'
              : selected
                ? 'Watched — the manager is told when a vehicle stops here'
                : undefined
          }
          className="lg:col-span-2"
          actions={
            draft || selected ? (
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setDraft(null);
                  setSelectedId(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge text-ink-dim hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : undefined
          }
        >
          {draft ? (
            <div className="space-y-4">
              <StationPhoto
                url={draft.kind === 'place' ? draft.place.photo_url : null}
                name={draftName}
                className="h-48 w-full rounded-xl"
              />
              {draft.kind === 'place' ? (
                <>
                  {draft.place.address && <p className="text-sm text-ink-mid">{draft.place.address}</p>}
                  {draft.place.is_fuel_station === false && (
                    <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                      Google does not list this place as a filling station. Watch it only if you
                      are sure it is one.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-ink-dim">
                  Google knows no filling station within 120 m of this point. Name it yourself to
                  watch it anyway.
                </p>
              )}
              <label className="block text-xs text-ink-dim">
                Name
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-edge bg-panel-deep px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </label>
              <div className="text-xs text-ink-dim">
                Zone radius
                <div className="mt-1 flex gap-1.5">
                  {RADIUS_CHOICES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRadius(r)}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        radius === r
                          ? 'border-brand bg-brand/15 font-semibold text-ink'
                          : 'border-edge text-ink-mid hover:text-ink'
                      }`}
                    >
                      {r} m
                    </button>
                  ))}
                </div>
                <p className="mt-1.5">
                  Tighter keeps vehicles on the road outside from counting. A visit is only
                  announced once the vehicle stands still inside for a minute.
                </p>
              </div>
              <button
                type="button"
                onClick={save}
                disabled={saving || !draftName.trim()}
                className="w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Watch this station'}
              </button>
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <StationPhoto url={selected.photo_url} name={selected.name} className="h-48 w-full rounded-xl" />
              {selected.address && <p className="text-sm text-ink-mid">{selected.address}</p>}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-edge bg-panel-deep px-3 py-2">
                  <dt className="text-xs text-ink-dim">Stops, 30 days</dt>
                  <dd className="font-semibold tabular-nums text-ink">{selected.stops_30d}</dd>
                </div>
                <div className="rounded-xl border border-edge bg-panel-deep px-3 py-2">
                  <dt className="text-xs text-ink-dim">Last stop</dt>
                  <dd className="font-semibold text-ink">
                    {selected.last_stop_at ? lagosTime(selected.last_stop_at) : 'None yet'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-ink-dim tabular-nums">{selected.radius_m} m zone</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStationFilter(selected.id)}
                  className="flex-1 rounded-full border border-edge px-3 py-2 text-xs font-semibold text-ink hover:border-brand"
                >
                  Show its visits
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(selected)}
                    aria-label={`Stop watching ${selected.name}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-2 text-xs text-ink-dim hover:border-bad/50 hover:text-bad"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Stop watching
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-edge px-4 py-10 text-center">
              <Fuel className="mx-auto mb-2 h-5 w-5 text-ink-dim" />
              <p className="text-sm text-ink-mid">
                {stations.length ? 'Pick a station to see it' : 'No stations watched yet'}
              </p>
              <p className="mt-1 text-xs text-ink-dim">
                When a vehicle stops at a watched station you get an alert, and the visit lands
                in the log below with the time it arrived and left.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {stations.length > 0 && (
        <Panel icon={Fuel} title="Watched stations" subtitle={`${stations.length} on watch`}>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {stations.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => selectStation(s)}
                  className={`flex w-full items-center gap-3 rounded-xl border bg-panel-deep p-2 text-left transition-colors ${
                    s.id === selectedId ? 'border-brand' : 'border-edge hover:border-ink-dim'
                  }`}
                >
                  <StationPhoto url={s.photo_url} name={s.name} className="h-14 w-14 shrink-0 rounded-lg" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                    <span className="block truncate text-xs text-ink-dim">
                      {s.stops_30d} stop{s.stops_30d === 1 ? '' : 's'} in 30 days
                      {s.last_stop_at ? ` · last ${lagosTime(s.last_stop_at)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        icon={History}
        title="Station visits"
        subtitle="Arrival and departure are read from the tracker's position fixes"
        onRefresh={loadVisits}
        refreshing={loadingVisits}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SegmentedPills
            items={PERIODS.map((p) => ({ id: p.id, label: p.label }))}
            active={period}
            onChange={setPeriod}
          />
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            Station
            <select
              value={stationFilter ?? ''}
              onChange={(e) => setStationFilter(e.target.value || null)}
              className="rounded-lg border border-edge bg-panel px-2 py-1 text-xs text-ink"
            >
              <option value="">All stations</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-dim">
            <input
              type="checkbox"
              checked={includePasses}
              onChange={(e) => setIncludePasses(e.target.checked)}
            />
            Include drive-pasts
          </label>
        </div>

        {!loadingVisits && visits.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-dim">
            {stations.length
              ? 'No visits in this period.'
              : 'Watch a station above and its visits will appear here.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-wider text-ink-dim">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3">Arrived</th>
                  <th className="whitespace-nowrap px-4 py-3">Station</th>
                  <th className="whitespace-nowrap px-4 py-3">Vehicle</th>
                  <th className="whitespace-nowrap px-4 py-3">Driver</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Time there</th>
                  <th className="whitespace-nowrap px-4 py-3">Left</th>
                  <th className="whitespace-nowrap px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider text-ink-mid">
                {visits.map((v) => {
                  const chip = STATUS_CHIP[v.status];
                  return (
                    <tr key={v.id} className="hover:bg-panel-hover">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink">
                        {lagosTime(v.entered_at)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            const s = stations.find((x) => x.id === v.station_id);
                            if (s) selectStation(s);
                          }}
                          className="flex items-center gap-2 text-left text-ink hover:underline"
                        >
                          <StationLogo merchant={v.station_name} size={18} />
                          {v.station_name}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                        {v.license_plate}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{v.driver_name || 'Unassigned'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {dwellLabel(v.dwell_seconds)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                        {v.exited_at ? lagosTime(v.exited_at, false) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
