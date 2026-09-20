// Vehicle licence ("VIO") papers: photographed, read, kept, and watched.
//
// The manager's side of the workflow is: photograph the paper, let OCR fill
// the form, correct what it garbled, save. From then on the row's expiry
// date drives the alert a week out. Everything here is scoped to the
// caller's own fleet; the sweep that raises the alerts lives in
// certificate-expiry-sweep.ts.
import express, { Request, Response } from 'express';
import { authenticateCustomer } from '../auth/auth.middleware';
import { db, vehicleCertificates, vehicles, drivers, eq, and, desc, sql } from '../../shared/db-helpers';
import { CERTIFICATE_KINDS, type CertificateKind } from '../../config/db/schema';
import { scanVioCertificate } from './vio-certificate.service';
import { logAndRespond } from '../../shared/errors';

const router = express.Router();
router.use(authenticateCustomer);

/** Validation and OCR failures carry their own status; anything else is a 500. */
const respond = (res: Response, path: string, error: unknown): void => {
  const status = (error as { status?: number }).status;
  if (status && status < 500) {
    res.status(status).json({ error: (error as Error).message });
    return;
  }
  logAndRespond(res, path, error);
};

/** How far out an expiry counts as "expiring". Matches the sweep. */
export const EXPIRY_WARNING_DAYS = Number(process.env.CERT_EXPIRY_WARNING_DAYS || 7);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown, max = 255): string | null => {
  const t = String(v ?? '').trim();
  return t ? t.slice(0, max) : null;
};

/** Everything the form can set, validated the same way on create and edit. */
function readFields(body: Record<string, unknown>) {
  const expiresOn = str(body.expires_on, 10);
  const issuedOn = str(body.issued_on, 10);
  if (expiresOn && !ISO_DATE.test(expiresOn)) throw Object.assign(new Error('expires_on must be YYYY-MM-DD'), { status: 400 });
  if (issuedOn && !ISO_DATE.test(issuedOn)) throw Object.assign(new Error('issued_on must be YYYY-MM-DD'), { status: 400 });
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    throw Object.assign(new Error('The expiry date is before the issue date.'), { status: 400 });
  }
  const kind = str(body.kind, 20) ?? 'vio';
  if (!CERTIFICATE_KINDS.includes(kind as CertificateKind)) {
    throw Object.assign(new Error(`kind must be one of: ${CERTIFICATE_KINDS.join(', ')}`), { status: 400 });
  }
  return {
    kind,
    vehicleId: str(body.vehicle_id, 36),
    driverId: str(body.driver_id, 36),
    ownerName: str(body.owner_name),
    ownerAddress: str(body.owner_address, 1000),
    fileNumber: str(body.file_number, 80),
    registrationNumber: str(body.registration_number, 40)?.toUpperCase() ?? null,
    engineNumber: str(body.engine_number, 80),
    chassisNumber: str(body.chassis_number, 80)?.toUpperCase() ?? null,
    vehicleMake: str(body.vehicle_make, 80),
    vehicleModel: str(body.vehicle_model, 80),
    vehicleType: str(body.vehicle_type, 80),
    issuingState: str(body.issuing_state, 80),
    issuedOn,
    expiresOn,
  };
}

/** The vehicle and driver must be the caller's, or the row is refused. */
async function assertOwned(customerId: string, vehicleId: string | null, driverId: string | null) {
  if (vehicleId) {
    const [v] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.customerId, customerId))).limit(1);
    if (!v) throw Object.assign(new Error('No such vehicle on this fleet.'), { status: 404 });
  }
  if (driverId) {
    const [d] = await db.select({ id: drivers.id }).from(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.customerId, customerId))).limit(1);
    if (!d) throw Object.assign(new Error('No such driver on this fleet.'), { status: 404 });
  }
}

const listSelect = {
  id: vehicleCertificates.id,
  kind: vehicleCertificates.kind,
  vehicle_id: vehicleCertificates.vehicleId,
  driver_id: vehicleCertificates.driverId,
  license_plate: vehicles.licensePlate,
  driver_name: drivers.fullName,
  owner_name: vehicleCertificates.ownerName,
  owner_address: vehicleCertificates.ownerAddress,
  file_number: vehicleCertificates.fileNumber,
  registration_number: vehicleCertificates.registrationNumber,
  engine_number: vehicleCertificates.engineNumber,
  chassis_number: vehicleCertificates.chassisNumber,
  vehicle_make: vehicleCertificates.vehicleMake,
  vehicle_model: vehicleCertificates.vehicleModel,
  vehicle_type: vehicleCertificates.vehicleType,
  issuing_state: vehicleCertificates.issuingState,
  issued_on: vehicleCertificates.issuedOn,
  expires_on: vehicleCertificates.expiresOn,
  has_image: sql<boolean>`${vehicleCertificates.imageUrl} IS NOT NULL`,
  days_to_expiry: sql<number>`(${vehicleCertificates.expiresOn} - CURRENT_DATE)::int`,
  created_by: vehicleCertificates.createdBy,
  created_at: vehicleCertificates.createdAt,
  updated_at: vehicleCertificates.updatedAt,
};

const statusFor = (days: number): 'expired' | 'expiring' | 'valid' =>
  days < 0 ? 'expired' : days <= EXPIRY_WARNING_DAYS ? 'expiring' : 'valid';

router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select(listSelect)
      .from(vehicleCertificates)
      .leftJoin(vehicles, eq(vehicleCertificates.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(vehicleCertificates.driverId, drivers.id))
      .where(eq(vehicleCertificates.customerId, req.user.customerId))
      .orderBy(vehicleCertificates.expiresOn, desc(vehicleCertificates.createdAt));

    const certificates = rows.map((r) => ({ ...r, status: statusFor(Number(r.days_to_expiry)) }));
    res.json({
      warning_days: EXPIRY_WARNING_DAYS,
      expiring: certificates.filter((c) => c.status === 'expiring').length,
      expired: certificates.filter((c) => c.status === 'expired').length,
      certificates,
    });
  } catch (error) {
    respond(res, req.path, error);
  }
});

/** The photo, served on its own so the list stays light. */
router.get('/:id/image', async (req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({ image: vehicleCertificates.imageUrl })
      .from(vehicleCertificates)
      .where(and(eq(vehicleCertificates.id, String(req.params.id)), eq(vehicleCertificates.customerId, req.user.customerId)))
      .limit(1);
    if (!row?.image) {
      res.status(404).json({ error: 'No photo on this certificate.' });
      return;
    }
    res.json({ image: row.image });
  } catch (error) {
    respond(res, req.path, error);
  }
});

/** OCR only — nothing is saved. The form shows the result for correction. */
router.post('/scan', async (req: Request, res: Response) => {
  const image = String((req.body ?? {}).image ?? '');
  if (!image) {
    res.status(400).json({ error: 'Attach a photo of the certificate.' });
    return;
  }
  try {
    const result = await scanVioCertificate(image);
    res.json(result);
  } catch (error) {
    respond(res, req.path, error);
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields = readFields(body);
    if (!fields.expiresOn) {
      res.status(400).json({ error: 'The expiry date is required — it is what the reminder runs on.' });
      return;
    }
    if (!fields.vehicleId && !fields.driverId) {
      res.status(400).json({ error: 'Attach the certificate to a vehicle or a driver.' });
      return;
    }
    await assertOwned(req.user.customerId, fields.vehicleId, fields.driverId);

    const [created] = await db
      .insert(vehicleCertificates)
      .values({
        ...fields,
        expiresOn: fields.expiresOn,
        customerId: req.user.customerId,
        imageUrl: str(body.image, 4_000_000),
        ocrText: str(body.ocr_text, 20_000),
        createdBy: req.user.name || req.user.email,
      })
      .returning({ id: vehicleCertificates.id });
    res.status(201).json({ id: created.id });
  } catch (error) {
    respond(res, req.path, error);
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fields = readFields(body);
    await assertOwned(req.user.customerId, fields.vehicleId, fields.driverId);

    const patch: Record<string, unknown> = { updatedAt: sql`NOW()` };
    // Only the keys the caller sent change; the form sends whole rows, but a
    // one-field edit must not blank the rest.
    const sent = new Set(Object.keys(body));
    const map: Record<string, keyof typeof fields> = {
      vehicle_id: 'vehicleId', driver_id: 'driverId', owner_name: 'ownerName',
      owner_address: 'ownerAddress', file_number: 'fileNumber',
      registration_number: 'registrationNumber', engine_number: 'engineNumber',
      chassis_number: 'chassisNumber', vehicle_make: 'vehicleMake',
      vehicle_model: 'vehicleModel', vehicle_type: 'vehicleType',
      issuing_state: 'issuingState', issued_on: 'issuedOn', expires_on: 'expiresOn',
    };
    for (const [wire, col] of Object.entries(map)) {
      if (sent.has(wire)) patch[col] = fields[col];
    }
    if (sent.has('expires_on')) {
      if (!fields.expiresOn) {
        res.status(400).json({ error: 'The expiry date cannot be cleared.' });
        return;
      }
      // A new expiry is a new deadline: let the sweep warn about it afresh.
      patch.expiryAlertSentAt = null;
      patch.expiredAlertSentAt = null;
    }

    const [updated] = await db
      .update(vehicleCertificates)
      .set(patch)
      .where(and(eq(vehicleCertificates.id, String(req.params.id)), eq(vehicleCertificates.customerId, req.user.customerId)))
      .returning({ id: vehicleCertificates.id });
    if (!updated) {
      res.status(404).json({ error: 'No such certificate on this fleet.' });
      return;
    }
    res.json({ id: updated.id });
  } catch (error) {
    respond(res, req.path, error);
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [deleted] = await db
      .delete(vehicleCertificates)
      .where(and(eq(vehicleCertificates.id, String(req.params.id)), eq(vehicleCertificates.customerId, req.user.customerId)))
      .returning({ id: vehicleCertificates.id });
    if (!deleted) {
      res.status(404).json({ error: 'No such certificate on this fleet.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    respond(res, req.path, error);
  }
});

export default router;
