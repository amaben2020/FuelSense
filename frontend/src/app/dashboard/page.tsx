'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bell,
  Calculator,
  ClipboardList,
  Clock,
  Fuel,
  Gauge,
  History,
  LandPlot,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  RadioTower,
  ReceiptText,
  Route,
  Search,
  Pentagon,
  Settings,
  SlidersHorizontal,
  ShieldAlert,
  Siren,
  Truck,
  Plus,
  Users,
  X,
} from 'lucide-react';
import {
  Alert,
  api,
  ApiError,
  clearToken,
  Customer,
  DashboardSummary,
  Driver,
  FleetEfficiency,
  FleetEfficiencyResponse,
  FleetEfficiencySummary,
  FleetVehicle,
  FuelAnomaly,
  FuelEventsResponse,
  FuelPurchasesResponse,
  FeatureFlags,
  fetchFeatureFlags,
  type FleetRole,
  getToken,
  TrackPoint,
  TripsResponse,
} from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useLatest } from '@/lib/use-latest';
import { buildVehicleTracks } from '@/lib/map-utils';
import { BrandMark } from '@/components/BrandMark';
import { BrandTheme } from '@/components/BrandTheme';
import { AddDeviceModal } from '@/components/AddDeviceModal';
import { ThemeToggle } from '@/components/ThemeToggle';
import { FleetOperationsOverview } from '@/components/dashboard/FleetOperationsOverview';
import { GreenDrivingBadge } from '@/components/dashboard/GreenDrivingBadge';
import { DashboardKpis } from '@/components/dashboard/DashboardKpis';
import { DriverSettingsPanel } from '@/components/dashboard/DriverSettingsPanel';
import { FuelPricePanel } from '@/components/dashboard/FuelPricePanel';
import { CompanySettingsPanel } from '@/components/dashboard/CompanySettingsPanel';
import { OdometerSettingsPanel } from '@/components/dashboard/OdometerSettingsPanel';
import { LowFuelBanner } from '@/components/dashboard/LowFuelBanner';
import { PowerUnplugBanner } from '@/components/dashboard/PowerUnplugBanner';
import { playNotificationChime } from '@/lib/notification-sound';
import { AlertToasts, AUDIBLE_ALERT_TYPES } from '@/components/dashboard/AlertToasts';
import { liveStreamUrl } from '@/lib/api';
import { bearingDeg } from '@/lib/map-utils';
import { useProductTitle } from '@/lib/product-name';
import { DailyActivityTable } from '@/components/dashboard/DailyActivityTable';
import { EstimatedConsumptionTable } from '@/components/dashboard/EstimatedConsumptionTable';
import { FuelEstimatePanel } from '@/components/dashboard/FuelEstimatePanel';
import { VehicleShowcase } from '@/components/dashboard/VehicleShowcase';
import { TripHistoryPanel } from '@/components/dashboard/TripHistoryPanel';
import { FleetEfficiencyReport } from '@/components/dashboard/FleetEfficiencyReport';
import { SavingsDashboard } from '@/components/dashboard/SavingsDashboard';
import { SiphonEventsSidebar } from '@/components/dashboard/SiphonEventsSidebar';
import {
  countActiveFuelEvents,
  FuelAnomaliesPanel,
} from '@/components/dashboard/FuelAnomaliesPanel';
import { FuelPurchaseTable, ReceiptsPanel } from '@/components/dashboard/ReceiptsPanel';
import { FuelAnalyticsPanel } from '@/components/dashboard/FuelAnalyticsPanel';
import { LiveMonitoringMap } from '@/components/dashboard/LiveMonitoringMap';
import { TelemetryHistoryTable } from '@/components/dashboard/TelemetryHistoryTable';
import { TheftAlertBanner } from '@/components/dashboard/AlertsList';
import { AlertsWorkbench } from '@/components/dashboard/AlertsWorkbench';
import { LoadErrorBanner } from '@/components/dashboard/LoadErrorBanner';
import { isPro } from '@/lib/plan';
import { DrivingBehaviorPanel } from '@/components/dashboard/DrivingBehaviorPanel';
import { DriverManagementPanel } from '@/components/dashboard/DriverManagementPanel';
import { GeofencesPanel } from '@/components/dashboard/GeofencesPanel';
import { CalibrationGuidePanel } from '@/components/dashboard/CalibrationGuidePanel';
import { FleetIntelligencePanel } from '@/components/dashboard/FleetIntelligencePanel';
import { VehicleRecordsPanel } from '@/components/dashboard/VehicleRecordsPanel';
import { NotificationSettingsPanel } from '@/components/dashboard/NotificationSettingsPanel';
import { AccountingLedgerPanel } from '@/components/dashboard/AccountingLedgerPanel';
import { TheftPanel } from '@/components/dashboard/TheftPanel';
import { CommanderDashboard } from '@/components/dashboard/CommanderDashboard';
import {
  IconRail,
  PageHeader,
  Panel,
  RoundButton,
  StatPills,
  type RailGroup,
  type RailItem,
  type StatPill,
} from '@/components/ui/chrome';
import { FleetCommandLoader } from '@/components/dashboard/FleetCommandLoader';

// Full dashboard reload cadence. Keep this modest — each cycle fires ~10 API
// calls, and aggressive polling trips the backend rate limiter (self-DoS).
// Cadence is set by how often the tracker actually reports, not by how live we
// want the page to feel. The FMC150 sends roughly every 2 minutes, so polling
// live data every 3 s meant ~39 of every 40 requests returned unchanged rows —
// which is what exhausted the database's monthly transfer allowance on
// 2026-08-09. Both intervals already skip hidden tabs; these values cut what a
// *visible* tab costs by an order of magnitude, and the visibility listener
// below refreshes immediately on focus so the slower cadence is not felt.
const REFRESH_MS = 30000;
const LIVE_REFRESH_MS = 20000;

type DashboardView =
  | 'command'
  | 'overview'
  | 'live'
  | 'vehicle'
  | 'trips'
  | 'behavior'
  | 'drivers'
  | 'intel'
  | 'records'
  | 'geofences'
  | 'fuel'
  | 'estimate'
  | 'receipts'
  | 'accounting'
  | 'anomalies'
  | 'theft'
  | 'alerts'
  | 'calibration'
  | 'settings';

/** No lucide glyph for the naira sign, so the rail icon is the character
 * itself, sized and weighted to sit alongside the stroke icons around it. */
function NairaIcon({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center font-bold ${className}`} aria-hidden>
      ₦
    </span>
  );
}

/** Sidebar entry -> feature flag key. A view with no mapping is always shown. */
const VIEW_FLAG: Partial<Record<DashboardView, string>> = {
  overview: 'fleet_overview',
  live: 'live_monitoring',
  vehicle: 'vehicle_view',
  trips: 'trip_history',
  behavior: 'driving_behavior',
  drivers: 'driver_management',
  intel: 'fleet_intelligence',
  geofences: 'geofences',
  fuel: 'fuel_analytics',
  estimate: 'fuel_estimate',
  receipts: 'receipts',
  accounting: 'accounting_ledger',
  anomalies: 'replay_events',
  theft: 'theft',
  alerts: 'alerts',
  calibration: 'calibration',
  settings: 'settings',
};

/** Views that depend on hardware a BASIC fleet does not have. */
const PRO_ONLY_VIEWS = new Set<DashboardView>(['anomalies']);

/**
 * Every role has the whole dashboard. The role only decides where it opens
 * and whether the Command Summary — reports, totals and trends, for someone
 * who reads the fleet rather than runs it — is on the rail at all.
 */
const ROLE_HOME: Record<FleetRole, DashboardView> = {
  manager: 'overview',
  commander: 'command',
};
const ROLE_LABEL: Record<FleetRole, string> = {
  manager: 'Manager',
  commander: 'Commander',
};

/** Immobilizer is still beta — one flag, flipped here, rather than tied to
 *  the subscription-tier logic `isPro()` drives. Swap for a real entitlement
 *  check once it graduates out of beta. */
const IMMOBILIZER_ENABLED = true;

/**
 * One record per destination. The rail, the mobile drawer and the page title
 * all read from here, so a new view needs a single entry rather than three
 * parallel edits. `nav` is the rail tooltip / drawer label; `title` is the
 * heading the page shows once the view is open.
 */
const VIEW_META: Record<
  DashboardView,
  { icon: React.ComponentType<{ className?: string }>; nav: string; title: string }
> = {
  command: { icon: LandPlot, nav: 'Command summary', title: 'Command Summary' },
  overview: { icon: LayoutDashboard, nav: 'Fleet overview', title: 'Operations Dashboard' },
  live: { icon: RadioTower, nav: 'Live monitoring', title: 'Live monitoring' },
  vehicle: { icon: Truck, nav: 'Vehicle view', title: 'Vehicle view' },
  trips: { icon: Route, nav: 'Trip history', title: 'Trip history' },
  behavior: { icon: ShieldAlert, nav: 'Driving behavior', title: 'Driving behavior' },
  drivers: { icon: Users, nav: 'Driver management', title: 'Driver Management' },
  intel: { icon: Gauge, nav: 'Fleet intelligence', title: 'Fleet Intelligence' },
  records: { icon: ClipboardList, nav: 'Vehicle records', title: 'Vehicle records' },
  geofences: { icon: Pentagon, nav: 'Geofencing', title: 'Geofencing' },
  fuel: { icon: Fuel, nav: 'Fuel analytics', title: 'Fuel analytics' },
  estimate: { icon: Calculator, nav: 'Fuel estimate', title: 'Fuel estimate' },
  receipts: { icon: ReceiptText, nav: 'Receipts', title: 'Receipts' },
  accounting: { icon: NairaIcon, nav: 'Accounting', title: 'Accounting' },
  anomalies: { icon: History, nav: 'Replay events', title: 'Replay events' },
  theft: { icon: Lock, nav: 'Theft', title: 'Theft & immobilizer' },
  alerts: { icon: Siren, nav: 'Alerts', title: 'Alerts' },
  calibration: { icon: SlidersHorizontal, nav: 'Calibration', title: 'Calibration' },
  settings: { icon: Settings, nav: 'Settings', title: 'Settings' },
};

const VIEWS: { id: DashboardView; label: string; hash: string }[] = [
  { id: 'command', label: 'Command summary', hash: 'command' },
  { id: 'overview', label: 'Operations', hash: 'overview' },
  { id: 'live', label: 'Live monitoring', hash: 'live' },
  { id: 'vehicle', label: 'Vehicle view', hash: 'vehicle' },
  { id: 'trips', label: 'Trip history', hash: 'trips' },
  { id: 'behavior', label: 'Driving behavior', hash: 'behavior' },
  { id: 'drivers', label: 'Driver management', hash: 'drivers' },
  { id: 'intel', label: 'Fleet intelligence', hash: 'intel' },
  { id: 'records', label: 'Vehicle records', hash: 'records' },
  { id: 'geofences', label: 'Geofencing', hash: 'geofences' },
  { id: 'fuel', label: 'Fuel analytics', hash: 'fuel' },
  { id: 'estimate', label: 'Fuel estimate', hash: 'estimate' },
  { id: 'receipts', label: 'Receipts', hash: 'receipts' },
  { id: 'accounting', label: 'Accounting', hash: 'accounting' },
  { id: 'anomalies', label: 'Replay events', hash: 'anomalies' },
  { id: 'theft', label: 'Theft', hash: 'theft' },
  { id: 'alerts', label: 'Alerts', hash: 'alerts' },
  { id: 'calibration', label: 'Calibration', hash: 'calibration' },
  { id: 'settings', label: 'Settings', hash: 'settings' },
];

/**
 * The rail groups seventeen destinations into five sections, matching what a
 * fleet manager is actually trying to do — get the daily picture, watch the
 * fleet, manage fuel spend, handle security, or configure the account —
 * rather than one undifferentiated list from Overview through Settings.
 */
const NAV_GROUPS: { label: string; views: DashboardView[] }[] = [
  { label: 'Overview', views: ['command', 'overview', 'live'] },
  {
    label: 'Fleet',
    views: ['vehicle', 'trips', 'behavior', 'drivers', 'intel', 'records', 'geofences'],
  },
  { label: 'Fuel', views: ['fuel', 'estimate', 'receipts', 'accounting', 'anomalies'] },
  { label: 'Security', views: ['theft', 'alerts'] },
  { label: 'System', views: ['calibration', 'settings'] },
];

export default function DashboardPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [fleet, setFleet] = useState<FleetVehicle[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // Every alert id ever seen this session, so a chime fires for a genuinely
  // new alert and not for one that was resolved and re-fetched, or on the
  // very first load of an account that already has a backlog.
  const seenAlertIds = useRef<Set<number> | null>(null);
  const [anomalies, setAnomalies] = useState<FuelAnomaly[]>([]);
  const [efficiency, setEfficiency] = useState<FleetEfficiency[]>([]);
  const [efficiencySummary, setEfficiencySummary] = useState<FleetEfficiencySummary | null>(null);
  const [fuelPurchases, setFuelPurchases] = useState<FuelPurchasesResponse | null>(null);
  const [fuelPurchasePage, setFuelPurchasePage] = useState(1);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [todaySummary, setTodaySummary] = useState<DashboardSummary | null>(null);
  const [fuelEvents, setFuelEvents] = useState<FuelEventsResponse | null>(null);
  const [liveTracks, setLiveTracks] = useState(
    () => buildVehicleTracks([] as TrackPoint[])
  );
  const [trips, setTrips] = useState<TripsResponse | null>(null);
  const tripsRef = useLatest(trips);
  const [pendingTripFocus, setPendingTripFocus] = useState<{
    vehicleId: string;
    startAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [efficiencyError, setEfficiencyError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const lastUpdatedRef = useLatest(lastUpdated);
  const refreshFailures = useRef(0);
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [autoDrawZone, setAutoDrawZone] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [followVehicle, setFollowVehicle] = useState(true);
  // Window the operational snapshot aggregates over. The API caps `days` at 90,
  // so a "year" option would have to be faked — these three are all real.
  const [periodDays, setPeriodDays] = useState(7);
  const periodDaysRef = useLatest(periodDays);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Sidebar visibility. Defaults to everything on so the nav never flashes
  // empty while the flags load; the server response then narrows it.
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [trailMinutes, setTrailMinutes] = useState(1440);
  const trailMinutesRef = useLatest(trailMinutes);
  // True while a trail the user asked for is on its way — the first load and
  // every range change. The silent 30 s refresh never sets it: a spinner that
  // flickers over a map that already has its trails is noise.
  const [tripsLoading, setTripsLoading] = useState(true);
  // False until the first set of positions has landed, so the map can say
  // it is placing the vehicles rather than sit empty.
  const [tracksReady, setTracksReady] = useState(false);
  // Explicit calendar range from the date picker. When set it supersedes the
  // rolling preset above; clearing it returns to the presets.
  const [tripRange, setTripRange] = useState<{ from: string; to: string } | null>(null);
  const tripRangeRef = useLatest(tripRange);
  // Opt-in to the server's "show the most recent journeys instead" widening.
  // Off by default so a chosen window always reports what is actually in it.
  const [tripFallback, setTripFallback] = useState(false);
  const tripFallbackRef = useLatest(tripFallback);
  const [siphonSidebarOpen, setSiphonSidebarOpen] = useState(false);
  const [fuelEventCount, setFuelEventCount] = useState(0);
  const { setCustomer: cacheCustomer, clearAuth } = useAuthStore();
  const activeViewRef = useLatest(activeView);

  const selectedVehicle = useMemo(
    () => fleet.find((v) => v.id === selectedVehicleId) ?? fleet[0] ?? null,
    [fleet, selectedVehicleId]
  );

  const onlineCount = fleet.filter((v) => v.connection_status === 'online').length;

  /**
   * Quick-jump for the top-bar search. Scoped to the fleet the dashboard has
   * already loaded, so it never issues a request — the field is a navigation
   * shortcut, not a backend search.
   */
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return fleet
      .filter((v) =>
        [v.license_plate, v.make, v.model, v.driver_name]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(q))
      )
      .slice(0, 6);
  }, [searchQuery, fleet]);

  const loadFuelPurchases = async (page = fuelPurchasePage, forReceipts = false) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: forReceipts ? '50' : '10',
      });
      if (forReceipts) params.set('include_summary', 'true');
      const purchaseData = await api<FuelPurchasesResponse>(
        `/telemetry/fuel-purchases?${params.toString()}`
      );
      setFuelPurchases((prev) => ({
        ...purchaseData,
        summary: purchaseData.summary ?? prev?.summary,
      }));
      setFuelPurchasePage(purchaseData.page);
    } catch {
      setFuelPurchases((prev) => prev);
    }
  };

  // Live positions only need a short tail — trip trails come from /trips,
  // which is segmented and downsampled server-side (no 2000-point cap).
  const loadLiveTracks = useCallback(async () => {
    try {
      const trackPoints = await api<TrackPoint[]>('/telemetry/tracks?minutes=15');
      setLiveTracks(buildVehicleTracks(trackPoints));
      setTracksReady(true);
    } catch {
      // no-op — keep existing tracks on error
    }
  }, []);

  const loadTrips = useCallback(async (opts: { announce?: boolean } = {}) => {
    if (opts.announce) setTripsLoading(true);
    try {
      const range = tripRangeRef.current;
      const params = new URLSearchParams(
        range
          ? { from: range.from, to: range.to }
          : { minutes: String(trailMinutesRef.current) },
      );
      if (tripFallbackRef.current) params.set('fallback', '1');
      const data = await api<TripsResponse>(`/telemetry/trips?${params.toString()}`);
      setTrips(data);
    } catch {
      // no-op — keep existing trips on error
    } finally {
      if (opts.announce) setTripsLoading(false);
    }
  }, []);

  const loadDashboard = async () => {
    try {
      // Read the store at call time, not the `cachedCustomer` this closure was
      // created with: the refresh interval keeps the mount-time closure alive,
      // and a rename made since would be overwritten by the stale copy on the
      // next tick.
      const storedCustomer = useAuthStore.getState().customer;
      const [meOrNull, fleetRows, alertList, anomalyList, fuelEvents] = await Promise.all([
        storedCustomer ? Promise.resolve(storedCustomer) : api<Customer>('/auth/me'),
        api<FleetVehicle[]>('/vehicles/fleet'),
        // Enough rows for the alert-detail section to enumerate the count the
        // summary headlines. The queue above it still shows a shortlist.
        api<Alert[]>('/alerts?limit=200'),
        api<FuelAnomaly[]>('/alerts/anomalies').catch(() => [] as FuelAnomaly[]),
        api<FuelEventsResponse>('/fuel-events').catch(() => null),
      ]);
      const me = meOrNull as Customer;
      if (!storedCustomer) cacheCustomer(me);

      if (!me.onboarding_completed && fleetRows.length === 0) {
        router.replace('/onboarding');
        return;
      }

      let efficiencyRows: FleetEfficiency[] = [];
      let summaryRow: DashboardSummary | null = null;

      try {
        const efficiencyData = await api<FleetEfficiencyResponse>(
          `/telemetry/fleet-efficiency?days=${periodDaysRef.current}`
        );
        efficiencyRows = efficiencyData.vehicles ?? [];
        setEfficiencySummary(efficiencyData.summary ?? null);
        setEfficiencyError(null);
      } catch (effErr) {
        setEfficiencySummary(null);
        setEfficiencyError(
          effErr instanceof Error ? effErr.message : 'Efficiency data unavailable'
        );
      }

      try {
        summaryRow = await api<DashboardSummary>(
          `/dashboard/summary?days=${periodDaysRef.current}`
        );
      } catch {
        summaryRow = null;
      }

      let todayRow: DashboardSummary | null = null;
      try {
        todayRow = await api<DashboardSummary>('/dashboard/summary?days=1');
      } catch {
        todayRow = null;
      }

      try {
        if (activeViewRef.current !== 'receipts') {
          await loadFuelPurchases(fuelPurchasePage);
        }
      } catch {
        /* fuel tab handles its own refresh */
      }

      let driverRows: Driver[] = [];
      try {
        driverRows = await api<Driver[]>('/drivers');
      } catch {
        driverRows = [];
      }

      // Visibility switches. On failure the existing flags stand rather than
      // collapsing the nav to nothing.
      try {
        setFlags((await fetchFeatureFlags()).flags);
      } catch {
        /* keep whatever we already resolved */
      }

      // A failed tracks call used to reset the map to no tracks at all, which
      // the live view renders as every vehicle "Offline" — a server restart
      // mid-refresh emptied a fleet that was reporting fine. Hold the last
      // positions instead; the live poller replaces them on its next tick.
      let trackPoints: TrackPoint[] | null = null;
      try {
        trackPoints = await api<TrackPoint[]>('/telemetry/tracks?minutes=15');
      } catch {
        trackPoints = null;
      }

      setCustomer(me);
      setFleet(fleetRows);
      setAlerts(alertList);
      setAnomalies(anomalyList);
      setFuelEvents(fuelEvents);
      setFuelEventCount(countActiveFuelEvents(fuelEvents));
      setEfficiency(efficiencyRows);
      setSummary(summaryRow);
      setTodaySummary(todayRow);
      setDrivers(driverRows);
      if (trackPoints) setLiveTracks(buildVehicleTracks(trackPoints));
      setLastUpdated(new Date());
      setTick((t) => t + 1);
      refreshFailures.current = 0;
      setError(null);

      // A selection that no longer exists is dropped; none is never invented.
      // The live map opens on the whole fleet and a car is picked on purpose;
      // views that need one vehicle fall back to the first via selectedVehicle.
      setSelectedVehicleId((prev) =>
        prev && fleetRows.some((v) => v.id === prev) ? prev : null
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        window.location.replace('/login');
        return;
      }
      // The error object is kept whole, not flattened to a string: the banner
      // needs its kind to say whether the network or the server is at fault.
      //
      // With a dashboard already on screen, one missed refresh is a blip —
      // a server restart, a dropped connection — and the data shown is at
      // most a refresh old. The banner waits for a second miss in a row so a
      // blip passes unannounced and an outage is still reported within a
      // minute. The first load has nothing to show, so it reports at once.
      refreshFailures.current += 1;
      if (!lastUpdatedRef.current || refreshFailures.current >= 2) setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getToken()) {
      window.location.replace('/login');
      return;
    }

    loadDashboard();
    const interval = setInterval(() => {
      if (!document.hidden) loadDashboard();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [router]);

  // Alerts new since the last poll, for the toasts — and a chime only when
  // one of them is the kind worth a sound. Not on the first page load of an
  // account that already has a backlog of open ones, and not for a trip
  // starting or a zone being entered: with a fleet on the road those come
  // every few minutes, and a chime for each is a dashboard nobody keeps open.
  useProductTitle('Dashboard');
  const [freshAlerts, setFreshAlerts] = useState<Alert[]>([]);
  useEffect(() => {
    if (alerts.length === 0) return;
    const ids = new Set(alerts.map((a) => a.id));
    if (seenAlertIds.current === null) {
      seenAlertIds.current = ids;
      return;
    }
    const fresh = alerts.filter((a) => !seenAlertIds.current!.has(a.id));
    seenAlertIds.current = ids;
    if (fresh.length === 0) return;
    setFreshAlerts(fresh);
    if (fresh.some((a) => AUDIBLE_ALERT_TYPES.has(a.alert_type))) playNotificationChime();
  }, [alerts]);
  const driverForVehicle = useCallback(
    (vehicleId: string | undefined) =>
      vehicleId ? (fleet.find((v) => v.id === vehicleId)?.driver_name ?? null) : null,
    [fleet],
  );

  // Returning to the tab refreshes once, rather than waiting out the interval.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !getToken()) return;
      loadDashboard();
      if (activeViewRef.current === 'live') loadLiveTracks();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLiveTracks]);

  useEffect(() => {
    if (activeView !== 'live' || !getToken()) return;
    loadLiveTracks();
    loadTrips({ announce: tripsRef.current === null });
    const interval = setInterval(() => {
      if (!document.hidden) loadLiveTracks();
    }, LIVE_REFRESH_MS);
    // Trips change slowly — refresh on a relaxed cadence
    const tripsInterval = setInterval(() => {
      if (!document.hidden) loadTrips();
    }, 30000);
    return () => {
      clearInterval(interval);
      clearInterval(tripsInterval);
    };
  }, [activeView, loadLiveTracks, loadTrips]);

  // Push, on top of the poll: each fix the tracker sends moves its marker the
  // moment the server has it, instead of waiting up to twenty seconds. The
  // poll stays as the source of truth for vehicles the stream has not seen.
  useEffect(() => {
    if (activeView !== 'live') return;
    const url = liveStreamUrl();
    if (!url || typeof EventSource === 'undefined') return;
    const source = new EventSource(url);
    source.addEventListener('position', (event) => {
      const p = JSON.parse((event as MessageEvent).data) as {
        vehicle_id: string;
        latitude: number;
        longitude: number;
        speed_kph: number | null;
        ignition_on: boolean | null;
        fuel_level_liters: number | null;
        recorded_at: string;
      };
      setLiveTracks((prev) =>
        prev.map((track) => {
          if (track.vehicleId !== p.vehicle_id) return track;
          const last = track.current;
          const moved = Math.abs(last.lat - p.latitude) > 1e-6 || Math.abs(last.lng - p.longitude) > 1e-6;
          return {
            ...track,
            path: moved ? [...track.path, { lat: p.latitude, lng: p.longitude }] : track.path,
            heading: moved ? bearingDeg(last.lat, last.lng, p.latitude, p.longitude) : track.heading,
            current: {
              ...last,
              lat: p.latitude,
              lng: p.longitude,
              speedKph: p.speed_kph,
              fuelLiters: p.fuel_level_liters ?? last.fuelLiters,
              ignitionOn: p.ignition_on,
              recordedAt: p.recorded_at,
            },
          };
        })
      );
    });
    return () => source.close();
  }, [activeView]);

  // Re-fetch immediately when the user changes trail duration, picks a date
  // range, or opts into the historical widening
  useEffect(() => {
    if (activeView === 'live' && getToken()) loadTrips({ announce: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailMinutes, tripRange, tripFallback]);

  useEffect(() => {
    if (!getToken()) return;
    loadFuelPurchases(fuelPurchasePage, activeView === 'receipts');
  }, [fuelPurchasePage, activeView]);

  // Refetch when the snapshot window changes. Skips the first run so changing
  // the period costs one request, not two on top of the initial load.
  const periodPrimed = useRef(false);
  useEffect(() => {
    if (!periodPrimed.current) {
      periodPrimed.current = true;
      return;
    }
    if (!getToken()) return;
    loadDashboard();
  }, [periodDays]);

  useEffect(() => {
    const hash = globalThis.window?.location.hash.replace('#', '') as DashboardView;
    if (hash && VIEWS.some((v) => v.id === hash)) {
      setActiveView(hash);
    }
  }, []);

  // Open on the role's home. A commander's session starts on the Command
  // Summary unless the URL asked for a specific view; a manager landing on a
  // hash for the commander's page is sent to operations.
  useEffect(() => {
    if (!customer) return;
    const r: FleetRole = customer.role ?? 'manager';
    const hashed = globalThis.window?.location.hash.replace('#', '');
    if (r === 'commander' && !hashed) switchView('command');
    if (r !== 'commander' && activeView === 'command') switchView(ROLE_HOME[r]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.role]);

  // ⌘K / Ctrl-K focuses the quick-jump, matching the hint rendered in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearchQuery('');
        searchRef.current?.blur();
      }
    };
    globalThis.window?.addEventListener('keydown', onKey);
    return () => globalThis.window?.removeEventListener('keydown', onKey);
  }, []);

  // Unmapped views and not-yet-loaded flags both show, so nothing disappears
  // on a slow response — only an explicit `false` hides an entry.
  const role: FleetRole = customer?.role ?? 'manager';
  const isVisible = (view: DashboardView): boolean => {
    if (view === 'command' && role !== 'commander') return false;
    // Replay events replays fuel *leaving* a tank, which needs a level sensor.
    // On GNSS-only hardware it has nothing to show, so it is held for PRO
    // rather than shipped as an empty screen.
    if (PRO_ONLY_VIEWS.has(view) && !isPro()) return false;
    if (view === 'theft' && !IMMOBILIZER_ENABLED) return false;
    const key = VIEW_FLAG[view];
    return key == null || flags[key] !== false;
  };

  const switchView = (view: DashboardView) => {
    setActiveView(view);
    setMobileNavOpen(false);
    markSeen(view);
    if (globalThis.window) {
      globalThis.window.history.replaceState(null, '', `#${view}`);
    }
  };

  const handleViewAlertOnMap = (alert: Alert) => {
    if (alert.vehicle_id) setSelectedVehicleId(alert.vehicle_id);
    switchView('live');
  };

  const handleViewAnomalyOnMap = (anomaly: FuelAnomaly) => {
    if (anomaly.vehicle_id) setSelectedVehicleId(anomaly.vehicle_id);
    switchView('live');
  };

  /**
   * Dismiss one alert from the list.
   *
   * The row is already animating out by the time this runs, so it is removed
   * optimistically — putting it back on failure would be a row flying out and
   * then reappearing, which reads as a bug rather than as an error.
   */
  /**
   * When this browser last opened a given view, as an epoch millisecond.
   *
   * Kept client-side deliberately. A server-side "read" flag would be a real
   * feature — per user, synced across devices — and inventing half of it here
   * (one shared flag for the whole account) would mean one manager reading
   * alerts silently cleared the badge for everyone else on the fleet.
   */
  const [seenAt, setSeenAt] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(window.localStorage.getItem('fuelsense_seen_at') || '{}');
    } catch {
      return {};
    }
  });

  /**
   * Stamp a view as seen. Called from navigation rather than from an effect
   * watching `activeView`: an effect would set state during render-commit on
   * every dependency change, and it fired again each time the alert list
   * refreshed while the view was already open.
   */
  const markSeen = useCallback((view: DashboardView) => {
    if (view !== 'alerts' && view !== 'receipts') return;
    const now = Date.now();
    setSeenAt((prev) => {
      const next = { ...prev, [view]: now };
      try {
        window.localStorage.setItem('fuelsense_seen_at', JSON.stringify(next));
      } catch {
        // Private mode or a full quota — the badge keeps showing, which is the
        // safe failure for a notification count.
      }
      return next;
    });
  }, []);

  const unseenAlertCount = useMemo(
    () => alerts.filter((a) => new Date(a.created_at).getTime() > (seenAt.alerts ?? 0)).length,
    [alerts, seenAt.alerts]
  );

  /**
   * Receipts filed since this browser last opened the receipts view.
   *
   * The badge previously carried `total` — every receipt the fleet has ever
   * filed — in the same red pill shape the alert count uses, so four receipts
   * on file looked exactly like four things demanding attention. Counted off
   * the purchases actually loaded, so it never claims more than it can show.
   */
  const unseenReceiptCount = useMemo(
    () =>
      (fuelPurchases?.purchases ?? []).filter(
        (r) => new Date(r.timestamp ?? r.purchased_at ?? 0).getTime() > (seenAt.receipts ?? 0)
      ).length,
    [fuelPurchases, seenAt.receipts]
  );


  const handleAcknowledgeAnomaly = async (id: string) => {
    try {
      await api(`/alerts/${id}/acknowledge`, { method: 'PATCH' });
      setAnomalies((prev) =>
        prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
      );
      setAlerts((prev) => prev.filter((a) => String(a.id) !== id));
    } catch {
      /* keep UI unchanged on failure */
    }
  };

  const handleLogout = () => {
    clearToken();
    clearAuth();
    router.push('/login');
  };

  const handleDeviceAdded = (row: FleetVehicle) => {
    setFleet((prev) => {
      const exists = prev.some((v) => v.id === row.id);
      return exists ? prev.map((v) => (v.id === row.id ? row : v)) : [row, ...prev];
    });
    setSelectedVehicleId(row.id);
    switchView('overview');
  };

  const viewTitle = VIEW_META[activeView].title;

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const initials = (customer?.company_name || customer?.name || 'FuelSense')
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

  /** Badge counts are only meaningful on a handful of destinations. */
  const navBadge: Partial<Record<DashboardView, number | undefined>> = {
    live: liveTracks.length || undefined,
    receipts: unseenReceiptCount || undefined,
    anomalies: fuelEventCount || undefined,
    // Unseen alerts, not open ones. The badge used to carry the full open
    // count, so it sat there permanently — a manager who had read every alert
    // still saw "22" and learned to ignore the number entirely, which is the
    // one thing a notification badge must never become. It now counts only
    // alerts raised since this browser last opened the alerts view.
    alerts: unseenAlertCount || undefined,
  };

  const navItems: RailItem<DashboardView>[] = VIEWS.filter((v) => isVisible(v.id)).map((v) => ({
    id: v.id,
    icon: VIEW_META[v.id].icon,
    label: VIEW_META[v.id].nav,
    badge: navBadge[v.id],
    tag: v.id === 'theft' ? 'Beta' : undefined,
  }));

  // Same items, sectioned per NAV_GROUPS. Built off `navItems` rather than
  // VIEWS directly so a view a feature flag has hidden drops out of its group
  // instead of leaving a labelled section with nothing under it; a group that
  // ends up empty (every view in it flagged off) is dropped entirely.
  const navGroups: RailGroup<DashboardView>[] = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.views
      .map((id) => navItems.find((item) => item.id === id))
      .filter((item): item is RailItem<DashboardView> => item != null),
  })).filter((g) => g.items.length > 0);

  /** The Haulix metric strip. Values stay terse — the row has to stay one line. */
  const statPills: StatPill[] = [
    {
      icon: Truck,
      label: 'Active',
      value: `${onlineCount}/${fleet.length}`,
      title: 'Vehicles reporting in the last cycle',
    },
    { icon: Users, label: 'Drivers', value: String(drivers.length) },
    {
      icon: Route,
      label: 'Trips',
      value: String(trips?.vehicles.reduce((n, v) => n + v.trips.length, 0) ?? 0),
    },
    // Efficiency is only shown once the backend has enough distance and fuel to
    // divide; an early "0.0 km/L" would read as a broken fleet rather than a
    // fleet that has not driven yet.
    ...(summary?.avg_efficiency_km_l != null
      ? [
          {
            icon: Fuel,
            label: 'Avg.',
            value: `${Number(summary.avg_efficiency_km_l).toFixed(1)} km/L`,
          } satisfies StatPill,
        ]
      : []),
    {
      // An absolute clock time rather than "12s ago": the relative form has to
      // read the wall clock during render, which is impure and re-renders
      // unpredictably.
      icon: Clock,
      label: 'Updated',
      value: lastUpdated
        ? lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—',
    },
  ];

  if (loading) {
    return <FleetCommandLoader />;
  }

  /* The rail mark. Falls back to the FuelSense Orbit Node when a white-label
     customer has not supplied their own logo. */
  const brandMark = customer?.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={customer.logo_url}
      alt={customer.company_name ?? customer.name}
      className="h-9 w-9 rounded-xl object-contain"
    />
  ) : (
    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-y text-accent-y-ink">
      <BrandMark className="h-6 w-6" strokeWidth={4} ariaLabel={customer?.company_name || 'FuelSense'} />
    </div>
  );

  const rail = (
    <IconRail
      brand={brandMark}
      brandLabel={customer?.company_name || customer?.name || 'FuelSense'}
      groups={navGroups}
      active={activeView}
      onSelect={switchView}
      footer={
        <>
          <ThemeToggle />
          <RoundButton icon={LogOut} label="Sign out" onClick={handleLogout} size="sm" />
        </>
      }
    />
  );

  const sidebar = (
    <>
      <div className="px-6 pb-6 pt-8">
        {/* White-label: a customer's own mark and name replace ours wherever
            they have supplied one. Everything falls back to FuelSense branding,
            so an account that has set nothing still looks finished. */}
        <div className="flex items-center gap-2.5">
          {customer?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={customer.logo_url}
              alt={customer.company_name ?? customer.name}
              className="h-7 w-7 shrink-0 rounded object-contain"
            />
          ) : (
            <BrandMark className="h-7 w-7 shrink-0 text-brand" strokeWidth={4} ariaLabel="FuelSense" />
          )}
          <p className="neon-text text-2xl font-bold">
            {customer?.company_name || 'FuelSense'}
          </p>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-good">
          Command center
        </p>
        <p className="text-xs text-ink-dim">
          {onlineCount}/{fleet.length} online
          {lastUpdated ? ` · ${lastUpdated.toLocaleTimeString()}` : ''}
        </p>
      </div>
      <nav className="px-3">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-4' : undefined}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
              {group.label}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  badge={item.badge}
                  active={activeView === item.id}
                  onClick={() => switchView(item.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div
      className={`bg-canvas text-ink ${activeView === 'live' ? 'h-dvh overflow-hidden' : 'min-h-screen'}`}
    >
      <BrandTheme customer={customer} />
      <aside className="glass fixed left-0 top-0 z-40 hidden h-full rounded-none border-y-0 border-l-0 lg:block">
        {rail}
      </aside>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="glass relative h-full w-64 rounded-none border-y-0 border-l-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="absolute right-3 top-3 rounded p-1 text-ink-mid"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <main
        className={`lg:ml-[76px] ${activeView === 'live' ? 'h-dvh overflow-hidden' : ''}`}
      >
        <div
          className={
            activeView === 'live'
              ? 'flex h-full flex-col overflow-hidden px-2 py-3 sm:px-4'
              : 'mx-auto max-w-[96rem] px-4 py-6 sm:px-6 lg:py-8'
          }
        >
          {/* Metric strip + global search + identity. Scrolls away with the
              page rather than sticking, matching the reference. */}
          <div
            className={`flex flex-wrap items-center justify-between gap-3 ${
              activeView === 'live' ? 'mb-2 shrink-0 px-1' : 'mb-7'
            }`}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className="rounded-full border border-edge bg-panel p-2.5 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <StatPills items={statPills} className="hidden sm:flex" />
            </div>

            <div className="flex items-center gap-2">
              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-dim" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  ref={searchRef}
                  placeholder="Search vehicles, trips, or more…"
                  aria-label="Search vehicles and trips"
                  className="w-64 rounded-full border border-edge bg-panel py-2.5 pl-10 pr-14 text-sm text-ink placeholder:text-ink-dim focus:border-accent-y focus:outline-none lg:w-80"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-edge bg-panel-deep px-1.5 py-0.5 text-[10px] font-medium text-ink-dim">
                  ⌘K
                </kbd>
                {searchQuery.trim() !== '' && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-edge bg-panel shadow-xl">
                    {searchResults.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-ink-dim">
                        No vehicle matches “{searchQuery.trim()}”
                      </p>
                    ) : (
                      searchResults.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setSelectedVehicleId(v.id);
                            setSearchQuery('');
                            searchRef.current?.blur();
                            switchView('vehicle');
                          }}
                          className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-panel-hover"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {v.license_plate}
                            </span>
                            <span className="block truncate text-xs text-ink-dim">
                              {[v.make, v.model].filter(Boolean).join(' ') || 'Unknown model'}
                              {v.driver_name ? ` · ${v.driver_name}` : ''}
                            </span>
                          </span>
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                              v.connection_status === 'online' ? 'bg-good' : 'bg-ink-dim'
                            }`}
                          />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Sits in the bar rather than floating over the page: as a
                  fixed badge it covered the live map's stop legend. Renders
                  nothing unless the trackers are actually reporting Eco
                  Driving. */}
              <GreenDrivingBadge />
              <div className="relative">
                {/* Unseen, not open — same reasoning as the rail badge. A
                    permanent red "22" on the bell is indistinguishable from a
                    red "22" that means something new just happened, so the
                    badge stopped carrying information. The button's own label
                    still names the full open count for screen readers, since
                    that is a statement of workload rather than a notification. */}
                <RoundButton
                  icon={Bell}
                  label={`Alerts${alerts.length ? ` (${alerts.length} open)` : ''}`}
                  onClick={() => switchView('alerts')}
                />
                {unseenAlertCount > 0 && (
                  <span className="pointer-events-none absolute -right-1 -top-1 inline-flex min-w-[1.15rem] justify-center rounded-full bg-bad-bright px-1 text-[10px] font-bold leading-[1.15rem] text-white">
                    {unseenAlertCount > 99 ? '99+' : unseenAlertCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 rounded-full border border-edge bg-panel py-1.5 pl-1.5 pr-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-y text-xs font-bold text-accent-y-ink">
                  {initials}
                </span>
                <div className="hidden leading-tight sm:block">
                  <p className="text-xs font-semibold text-ink">
                    {customer?.user?.name || customer?.company_name || customer?.name || 'FuelSense'}
                  </p>
                  <p className="text-[10px] text-ink-dim">
                    {customer?.user?.title || ROLE_LABEL[role]}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Above the page header so both read as a condition of the fleet
              rather than of whichever view happens to be open. Unplug leads —
              it outranks a low tank, because it can mean the evidence stream
              itself is about to stop. */}
          <PowerUnplugBanner
            fleet={fleet}
            onSelectVehicle={(id) => {
              setSelectedVehicleId(id);
              switchView('live');
            }}
          />
          <LowFuelBanner
            fleet={fleet}
            onSelectVehicle={(id) => {
              setSelectedVehicleId(id);
              switchView('live');
            }}
          />

          <header
            className={`flex flex-wrap items-start justify-between gap-4 ${
              activeView === 'live' ? 'mb-2 shrink-0 px-1' : 'mb-8'
            }`}
          >
            <PageHeader
              title={viewTitle}
              subtitle={
                activeView === 'live'
                  ? `${customer?.company_name || customer?.name} · ${onlineCount}/${fleet.length} online · refresh every ${LIVE_REFRESH_MS / 1000}s`
                  : `${todayLabel} · ${
                      lastUpdated
                        ? `updated ${lastUpdated.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}`
                        : 'updating…'
                    }`
              }
            />
            {/* Theme toggle and sign-out now live in the rail footer, so the
                header keeps only the controls that act on the current view. */}
            <div className="flex flex-wrap items-center gap-2">
              {activeView === 'live' && (
                <button
                  type="button"
                  onClick={() => setFollowVehicle((v) => !v)}
                  className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                    followVehicle
                      ? 'border-good bg-good/10 text-good'
                      : 'border-edge bg-panel text-ink-mid hover:bg-panel-hover'
                  }`}
                >
                  {followVehicle ? 'Following vehicle' : 'Free map'}
                </button>
              )}
              {/* A bare "0 live" reads as "the system is broken" before the
                  user has seen anything else — especially on a small fleet
                  where zero is the normal resting state between trips. A
                  neutral last-seen time says the same thing without the
                  alarm. */}
              {onlineCount > 0 ? (
                <div className="flex items-center gap-2 rounded-full border border-edge bg-panel px-4 py-2 text-sm">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-good" />
                  </span>
                  <span className="text-good">{onlineCount} live</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-edge bg-panel px-4 py-2 text-sm text-ink-dim">
                  <span className="h-2 w-2 rounded-full bg-ink-dim/50" />
                  <span>
                    {lastUpdated
                      ? `Last seen ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'No vehicles online'}
                  </span>
                </div>
              )}
              <Link
                href="/dashboard/orders/new"
                className="rounded-full border border-edge bg-panel px-4 py-2 text-sm text-ink-mid transition-colors hover:bg-panel-hover"
              >
                Buy trackers
              </Link>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-2 rounded-full bg-accent-y px-4 py-2 text-sm font-semibold text-accent-y-ink transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4" /> Add vehicle
              </button>
            </div>
          </header>

          <LoadErrorBanner
            error={error}
            subject="the dashboard"
            onRetry={() => loadDashboard()}
            className={activeView === 'live' ? 'mb-2 shrink-0' : 'mb-6'}
          />

          {activeView === 'command' && (
            <CommanderDashboard
              customer={customer}
              summary={summary}
              efficiency={efficiency}
              efficiencySummary={efficiencySummary}
              fleet={fleet}
              alerts={alerts}
              periodDays={periodDays}
              onPeriodChange={setPeriodDays}
            />
          )}

          {activeView === 'overview' && (
            <div className="space-y-6">
              <TheftAlertBanner alerts={alerts} onViewOnMap={handleViewAlertOnMap} />
              <FleetOperationsOverview
                periodDays={periodDays}
                onPeriodChange={setPeriodDays}
                summary={summary}
                todaySummary={todaySummary}
                efficiency={efficiency}
                efficiencySummary={efficiencySummary}
                alerts={alerts}
                anomalies={anomalies}
                fuelEvents={fuelEvents}
                fleet={fleet}
                onOpenLive={(vehicleId) => {
                  if (vehicleId) setSelectedVehicleId(vehicleId);
                  switchView('live');
                }}
                onOpenAnomalies={() => switchView('anomalies')}
                onViewOnMap={(vehicleId) => {
                  setSelectedVehicleId(vehicleId);
                  switchView('live');
                }}
                onOpenAlerts={() => switchView('alerts')}
              />
            </div>
          )}

          {activeView === 'live' && (
            <div className="min-h-0 flex-1 overflow-hidden">
              <LiveMonitoringMap
                tracks={liveTracks}
                trips={trips}
                tripsLoading={tripsLoading}
                tracksReady={tracksReady}
                fleet={fleet}
                startDrawing={autoDrawZone}
                onDrawingStarted={() => setAutoDrawZone(false)}
                initialFocus={pendingTripFocus}
                onFocusConsumed={() => setPendingTripFocus(null)}
                selectedVehicleId={selectedVehicleId}
                onSelectVehicle={setSelectedVehicleId}
                followSelected={followVehicle}
                onUserPan={() => setFollowVehicle(false)}
                trailMinutes={trailMinutes}
                onTrailMinutesChange={(m) => {
                  setTripRange(null);
                  setTripFallback(false);
                  setTrailMinutes(m);
                }}
                dateRange={tripRange}
                onDateRangeChange={(r) => {
                  setTripFallback(false);
                  setTripRange(r);
                }}
                onShowRecentInstead={() => setTripFallback(true)}
              />
            </div>
          )}

          {activeView === 'fuel' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => switchView('anomalies')}
                  className="rounded-lg border border-bad/40 bg-bad-deep/20 px-4 py-2 text-sm text-bad hover:bg-bad-deep/30"
                >
                  Replay events →
                </button>
              </div>
              <DashboardKpis summary={summary} />
              {efficiencyError && (
                <p className="text-sm text-warn">{efficiencyError}</p>
              )}
              <SavingsDashboard summary={efficiencySummary} />
              <FuelAnalyticsPanel
                efficiency={efficiency}
                efficiencySummary={efficiencySummary}
                anomalies={anomalies}
                onAcknowledgeAnomaly={handleAcknowledgeAnomaly}
                onViewOnMap={handleViewAnomalyOnMap}
              />
              <EstimatedConsumptionTable />
              <FleetEfficiencyReport rows={efficiency} summary={efficiencySummary} />
              <DailyActivityTable
                onViewDay={(vehicleId) => {
                  setSelectedVehicleId(vehicleId);
                  switchView('live');
                }}
              />
              <TelemetryHistoryTable />
              <FuelPurchaseTable
                data={fuelPurchases}
                fleet={fleet}
                page={fuelPurchasePage}
                onPageChange={setFuelPurchasePage}
                onRefresh={() => loadFuelPurchases(fuelPurchasePage, false)}
                onOpenReceipts={() => switchView('receipts')}
              />
            </div>
          )}

          {activeView === 'trips' && (
            <TripHistoryPanel
              onViewTrip={(vehicleId, tripStartAt) => {
                setSelectedVehicleId(vehicleId);
                setPendingTripFocus({ vehicleId, startAt: tripStartAt });
                setFollowVehicle(false);
                switchView('live');
              }}
            />
          )}

          {activeView === 'behavior' && (
            <DrivingBehaviorPanel />
          )}

          {activeView === 'intel' && <FleetIntelligencePanel />}

          {activeView === 'records' && <VehicleRecordsPanel fleet={fleet} />}

          {activeView === 'calibration' && <CalibrationGuidePanel fleet={fleet} />}

          {activeView === 'geofences' && (
            <GeofencesPanel
              onDrawZone={() => {
                setAutoDrawZone(true);
                switchView('live');
              }}
            />
          )}

          {activeView === 'drivers' && (
            <DriverManagementPanel onViewVehicle={() => switchView('vehicle')} />
          )}

          {activeView === 'vehicle' && (
            <VehicleShowcase
              fleet={fleet}
              selectedVehicleId={selectedVehicleId}
              onSelectVehicle={setSelectedVehicleId}
              onOpenLive={(vehicleId) => {
                setSelectedVehicleId(vehicleId);
                switchView('live');
              }}
            />
          )}

          {activeView === 'estimate' && <FuelEstimatePanel />}

          {activeView === 'receipts' && (
            <ReceiptsPanel
              data={fuelPurchases}
              fleet={fleet}
              page={fuelPurchasePage}
              onPageChange={setFuelPurchasePage}
              onRefresh={() => loadFuelPurchases(fuelPurchasePage, true)}
            />
          )}

          {activeView === 'accounting' && <AccountingLedgerPanel />}

          {activeView === 'anomalies' && (
            <FuelAnomaliesPanel
              active={activeView === 'anomalies'}
              onViewOnMap={(lat, lng, vehicleId) => {
                setSelectedVehicleId(vehicleId);
                switchView('live');
              }}
            />
          )}

          {activeView === 'theft' && <TheftPanel fleet={fleet} />}

          {activeView === 'alerts' && (
            <div className="rounded-lg border border-edge bg-panel p-6">
              <h2 className="font-semibold text-ink">All active alerts</h2>
              <p className="mt-1 text-xs text-ink-dim">
                Select rows to resolve several at once. Fuel anomaly alerts carry
                the tracker&apos;s GPS coordinates.
              </p>
              <div className="mt-4">
                <AlertsWorkbench
                  alerts={alerts}
                  onResolved={(ids) =>
                    setAlerts((prev) => prev.filter((a) => !ids.includes(a.id)))
                  }
                  onViewOnMap={handleViewAlertOnMap}
                />
              </div>
            </div>
          )}

          {activeView === 'settings' && (
            /* Settings was three components with three different container
               styles stacked in a full-width column, which read as unrelated
               pages. One Panel shell, one column width, and the shortcuts as a
               uniform icon grid pulls it back into a single screen. */
            <div className="mx-auto max-w-4xl space-y-4">
              <Panel
                icon={Settings}
                title="Fleet setup"
                subtitle="Register hardware and hand drivers the tools they need"
              >
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {[
                    {
                      key: 'add-device',
                      icon: Plus,
                      title: 'Add vehicle + IMEI',
                      hint: 'Register a new tracker',
                      onClick: () => setModalOpen(true),
                    },
                    {
                      key: 'bulk-add',
                      icon: Truck,
                      title: 'Add several vehicles at once',
                      hint: 'One form for up to 20 — onboarding several trackers together',
                      href: '/onboarding',
                    },
                    {
                      key: 'driver-portal',
                      icon: ReceiptText,
                      title: 'Driver receipt portal',
                      hint: 'Mobile upload — matches OBD automatically',
                      href: '/driver',
                    },
                    {
                      key: 'order',
                      icon: Truck,
                      title: 'Order trackers',
                      hint: 'Buy additional FMC150 devices',
                      href: '/dashboard/orders/new',
                    },
                  ].map(({ key, icon: ItemIcon, title, hint, onClick, href }) => {
                    const body = (
                      <>
                        <span className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-canvas text-ink-mid">
                          <ItemIcon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="block text-sm font-semibold text-ink">{title}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-ink-dim">
                          {hint}
                        </span>
                      </>
                    );
                    const shell =
                      'block rounded-xl border border-edge bg-panel-deep p-4 text-left transition-colors hover:bg-panel-hover';
                    return href ? (
                      <Link key={key} href={href} className={shell}>
                        {body}
                      </Link>
                    ) : (
                      <button key={key} type="button" onClick={onClick} className={shell}>
                        {body}
                      </button>
                    );
                  })}
                </div>
              </Panel>

              <CompanySettingsPanel customer={customer} onChanged={setCustomer} />
              <NotificationSettingsPanel />
              <FuelPricePanel />
              <OdometerSettingsPanel fleet={fleet} onChanged={loadDashboard} />
              <DriverSettingsPanel
                drivers={drivers}
                fleet={fleet}
                onAssigned={loadDashboard}
              />
            </div>
          )}
        </div>
      </main>

      <AddDeviceModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={handleDeviceAdded}
      />

      <AlertToasts incoming={freshAlerts} driverFor={driverForVehicle} />

      <SiphonEventsSidebar
        isOpen={siphonSidebarOpen}
        onClose={() => setSiphonSidebarOpen(false)}
        onViewOnMap={(lat, lng, vehicleId) => {
          setSelectedVehicleId(vehicleId);
          setSiphonSidebarOpen(false);
          switchView('live');
        }}
      />
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        active
          ? 'border-l-2 border-l-brand bg-accent/10 text-brand'
          : 'text-ink-mid hover:bg-panel-hover'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-good/20 px-1.5 py-0.5 text-xs text-good">
          {badge}
        </span>
      )}
    </button>
  );
}
