// Fuel stations a manager watches, and every visit the tracker saw to them.
//
// A station is stored as an ordinary circle geofence with purpose
// 'fuel_station', so the live geofence monitor evaluates it with no extra
// ingest path; this router only adds the Google lookup to create one and the
// visit log to read back.
import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db, sql, eq, and } from '../../shared/db-helpers';
import { geofences } from '../../config/db/schema';
import { logAndRespond } from '../../shared/errors';
import {
  nearbyFuelStation,
  placeDetails,
  placePhotoPath,
} from '../places/place-lookup.service';

const router = express.Router();
router.use(authenticateCustomer);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_RADIUS_M = 60;
const MIN_RADIUS_M = 30;
const MAX_RADIUS_M = 300;

const clampDays = (raw: unknown, fallback: number) =>
  Math.min(Math.max(Number(raw) || fallback, 1), 90);

const validCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await db.execute(sql`
      SELECT g.id, g.name, g.address, g.place_id, g.photo_ref, g.radius_m, g.created_at,
             g.center_lat::double precision AS lat,
             g.center_lng::double precision AS lng,
             COUNT(v.id) FILTER (WHERE v.stopped_at IS NOT NULL)::int AS stops_30d,
             MAX(v.stopped_at) AS last_stop_at
      FROM geofences g
      LEFT JOIN fuel_station_visits v
        ON v.geofence_id = g.id AND v.entered_at > NOW() - INTERVAL '30 days'
      WHERE g.customer_id = ${req.user.customerId}
        AND g.purpose = 'fuel_station'
      GROUP BY g.id
      ORDER BY g.name
    `);
    res.json(
      rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: row.id,
          name: row.name,
          address: row.address,
          place_id: row.place_id,
          photo_url: placePhotoPath((row.photo_ref as string) ?? null),
          latitude: Number(row.lat),
          longitude: Number(row.lng),
          radius_m: row.radius_m,
          stops_30d: row.stops_30d,
          last_stop_at: row.last_stop_at,
          created_at: row.created_at,
        };
      })
    );
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** The filling station nearest a point clicked on the map, if Google knows one. */
router.get('/nearby', async (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!validCoord(lat, lng)) {
    res.status(400).json({ error: 'valid lat and lng are required' });
    return;
  }
  try {
    const station = await nearbyFuelStation(lat, lng);
    res.json({
      station:
        station && station.placeId && station.latitude != null && station.longitude != null
          ? {
              place_id: station.placeId,
              name: station.name,
              address: station.address,
              latitude: station.latitude,
              longitude: station.longitude,
              photo_url: station.photoUrl,
              distance_m: station.distanceMeters,
            }
          : null,
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Preview of a place picked from the search box, before it is saved. */
router.get('/place/:placeId', async (req: Request, res: Response) => {
  try {
    const place = await placeDetails(String(req.params.placeId));
    if (!place) {
      res.status(404).json({ error: 'Place not found' });
      return;
    }
    res.json({
      place_id: place.placeId,
      name: place.name,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      photo_url: place.photoUrl,
      is_fuel_station: place.isFuelStation,
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * Watch a station. With a place_id the name, centre, address and photo come
 * from Google, so a manager cannot mistype them; without one (a forecourt
 * Google does not list) a name and the clicked point are required.
 */
router.post('/', async (req: Request, res: Response) => {
  const { place_id: placeId, name, latitude, longitude, radius_m: rawRadius } = req.body ?? {};
  const radiusM = Math.min(
    Math.max(Math.round(Number(rawRadius) || DEFAULT_RADIUS_M), MIN_RADIUS_M),
    MAX_RADIUS_M
  );

  try {
    let station: {
      name: string;
      lat: number;
      lng: number;
      address: string | null;
      placeId: string | null;
      photoRef: string | null;
    };

    if (placeId) {
      const place = await placeDetails(String(placeId));
      if (!place) {
        res.status(404).json({ error: 'Google could not resolve that place' });
        return;
      }
      station = {
        name: String(name ?? '').trim() || place.name,
        lat: place.latitude,
        lng: place.longitude,
        address: place.address,
        placeId: place.placeId,
        photoRef: place.photoRef,
      };
    } else {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!String(name ?? '').trim() || !validCoord(lat, lng)) {
        res.status(400).json({ error: 'name, latitude and longitude are required without a place_id' });
        return;
      }
      station = {
        name: String(name).trim(),
        lat,
        lng,
        address: null,
        placeId: null,
        photoRef: null,
      };
    }

    if (station.placeId) {
      const [existing] = await db
        .select({ id: geofences.id })
        .from(geofences)
        .where(
          and(
            eq(geofences.customerId, req.user.customerId),
            eq(geofences.purpose, 'fuel_station'),
            eq(geofences.placeId, station.placeId)
          )
        )
        .limit(1);
      if (existing) {
        res.status(409).json({ error: `${station.name} is already being watched` });
        return;
      }
    }

    const [row] = await db
      .insert(geofences)
      .values({
        customerId: req.user.customerId,
        name: station.name.slice(0, 120),
        shape: 'circle',
        centerLat: station.lat.toFixed(6),
        centerLng: station.lng.toFixed(6),
        radiusM,
        purpose: 'fuel_station',
        notifyOn: 'enter',
        placeId: station.placeId,
        address: station.address,
        photoRef: station.photoRef,
      })
      .returning({ id: geofences.id });

    res.status(201).json({ id: row.id });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .delete(geofences)
      .where(
        and(
          eq(geofences.id, String(req.params.id)),
          eq(geofences.customerId, req.user.customerId),
          eq(geofences.purpose, 'fuel_station')
        )
      )
      .returning({ id: geofences.id });
    if (!row) {
      res.status(404).json({ error: 'Station not found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * The visit log. Drive-bys (entered, never stood still) are left out unless
 * `include_passes=true` — they are real crossings but not visits, and on a
 * station beside a busy road they would bury the stops.
 */
router.get('/visits', async (req: Request, res: Response) => {
  const days = clampDays(req.query.days, 30);
  const rawStation = typeof req.query.station_id === 'string' ? req.query.station_id : '';
  const stationId = UUID_RE.test(rawStation) ? rawStation : '';
  const includePasses = req.query.include_passes === 'true';

  try {
    const rows = await db.execute(sql`
      SELECT v.id, v.geofence_id, g.name AS station_name, g.address, g.photo_ref,
             g.center_lat::double precision AS lat, g.center_lng::double precision AS lng,
             v.vehicle_id, ve.license_plate,
             COALESCE(v.driver_name, ve.driver_name) AS driver_name,
             v.entered_at, v.stopped_at, v.exited_at,
             EXTRACT(EPOCH FROM (COALESCE(v.exited_at, NOW()) - v.entered_at))::int AS dwell_s
      FROM fuel_station_visits v
      JOIN geofences g ON g.id = v.geofence_id
      JOIN vehicles ve ON ve.id = v.vehicle_id
      WHERE v.customer_id = ${req.user.customerId}
        AND v.entered_at > NOW() - (${days} || ' days')::INTERVAL
        ${stationId ? sql`AND v.geofence_id = ${stationId}::uuid` : sql``}
        ${includePasses ? sql`` : sql`AND v.stopped_at IS NOT NULL`}
      ORDER BY v.entered_at DESC
      LIMIT 500
    `);

    res.json({
      period_days: days,
      visits: rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: Number(row.id),
          station_id: row.geofence_id,
          station_name: row.station_name,
          address: row.address,
          photo_url: placePhotoPath((row.photo_ref as string) ?? null),
          latitude: Number(row.lat),
          longitude: Number(row.lng),
          vehicle_id: row.vehicle_id,
          license_plate: row.license_plate,
          driver_name: row.driver_name,
          entered_at: row.entered_at,
          stopped_at: row.stopped_at,
          exited_at: row.exited_at,
          dwell_seconds: Number(row.dwell_s),
          status: row.stopped_at ? (row.exited_at ? 'stopped' : 'on_site') : 'passed',
        };
      }),
    });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
