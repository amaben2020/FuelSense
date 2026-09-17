'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  AlertTriangle,
  FileBadge,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  ScanLine,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  CertificateFields,
  CertificateScan,
  Driver,
  FleetVehicle,
  VehicleCertificate,
  createCertificate,
  deleteCertificate,
  fetchCertificateImage,
  fetchCertificates,
  scanCertificate,
  updateCertificate,
} from '@/lib/api';
import { compressReceiptImage } from '@/lib/receipt-image';
import { Panel, StatusChip, TabRow } from '@/components/ui/chrome';

const INPUT =
  'w-full rounded-lg border border-edge bg-panel px-2 py-1.5 text-sm text-ink placeholder-ink-dim';

const EMPTY: CertificateFields = {
  owner_name: null,
  owner_address: null,
  file_number: null,
  registration_number: null,
  engine_number: null,
  chassis_number: null,
  vehicle_make: null,
  vehicle_model: null,
  vehicle_type: null,
  issuing_state: null,
  issued_on: null,
  expires_on: null,
};

/** Row order of the review table — the two facts the reminder runs on first. */
const FIELDS: Array<{ key: keyof CertificateFields; label: string; type?: 'date' }> = [
  { key: 'registration_number', label: 'Registration number' },
  { key: 'expires_on', label: 'Expires on', type: 'date' },
  { key: 'issued_on', label: 'Date issued', type: 'date' },
  { key: 'issuing_state', label: 'Issuing state' },
  { key: 'owner_name', label: "Owner's name" },
  { key: 'owner_address', label: 'Address' },
  { key: 'file_number', label: 'File number' },
  { key: 'chassis_number', label: 'Chassis number' },
  { key: 'engine_number', label: 'Engine number' },
  { key: 'vehicle_make', label: 'Make' },
  { key: 'vehicle_model', label: 'Model' },
  { key: 'vehicle_type', label: 'Vehicle type' },
];

const longDate = (iso: string | null): string =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-NG', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

const daysLabel = (c: VehicleCertificate): string => {
  const d = c.days_to_expiry;
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} ago`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
};

const normPlate = (v: string | null | undefined): string => (v ?? '').replace(/[\s-]/g, '').toUpperCase();

interface Draft {
  id: string | null;
  fields: CertificateFields;
  vehicle_id: string;
  driver_id: string;
  image: string | null;
  ocr_text: string | null;
  scan: CertificateScan | null;
}

type Tab = 'upload' | 'view';

/**
 * Vehicle licence (VIO) papers, with the expiry the reminder runs on.
 *
 * Upload: a drop target fills the page until a photo lands on it; then OCR
 * reads the paper and the same space becomes a table of what it read, one
 * row per field, each editable — because a photocopied sticker is never read
 * perfectly and the manager is the one who can tell. Save files it.
 *
 * View: everything on file, soonest expiry first. The backend sweep raises an
 * alert a week before a date and again once it has passed, so this is also
 * where a manager lands from that alert to see which paper it was.
 */
export function VioCertificatesPanel({
  fleet = [],
  drivers = [],
  readOnly = false,
}: {
  fleet?: FleetVehicle[];
  drivers?: Driver[];
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(readOnly ? 'view' : 'upload');
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchCertificates>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ id: string; image: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchCertificates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load certificates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const plateToVehicle = useMemo(
    () => new Map(fleet.map((v) => [normPlate(v.license_plate), v.id])),
    [fleet]
  );

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setScanning(true);
      setError(null);
      try {
        const image = await compressReceiptImage(file);
        const scan = await scanCertificate(image);
        const fields = { ...EMPTY };
        for (const f of FIELDS) fields[f.key] = scan.fields[f.key] ?? null;
        // A plate the fleet already knows picks the vehicle for them.
        const vehicle_id = plateToVehicle.get(normPlate(fields.registration_number)) ?? '';
        setDraft({ id: null, fields, vehicle_id, driver_id: '', image, ocr_text: scan.ocr_text, scan });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that photo');
      } finally {
        setScanning(false);
      }
    },
    [plateToVehicle]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    multiple: false,
    disabled: scanning || readOnly,
    // What OCR.space and every browser canvas can read. HEIC straight off an
    // iPhone is neither; the hint below says so.
    accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'] },
    maxSize: 15 * 1024 * 1024,
  });

  const startEdit = (c: VehicleCertificate) => {
    setDraft({
      id: c.id,
      fields: FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: c[f.key] ?? null }), { ...EMPTY }),
      vehicle_id: c.vehicle_id ?? '',
      driver_id: c.driver_id ?? '',
      image: null,
      ocr_text: null,
      scan: null,
    });
    setTab('upload');
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        ...draft.fields,
        vehicle_id: draft.vehicle_id || null,
        driver_id: draft.driver_id || null,
      };
      if (draft.id) {
        await updateCertificate(draft.id, body);
      } else {
        await createCertificate({ ...body, image: draft.image, ocr_text: draft.ocr_text });
      }
      setDraft(null);
      await load();
      setTab('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: VehicleCertificate) => {
    if (!window.confirm(`Delete the ${c.registration_number ?? c.license_plate ?? ''} certificate? The reminder goes with it.`)) return;
    try {
      await deleteCertificate(c.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  const showImage = async (c: VehicleCertificate) => {
    try {
      const { image } = await fetchCertificateImage(c.id);
      setPreview({ id: c.id, image });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No photo on file');
    }
  };

  const certificates = data?.certificates ?? [];
  const canSave = Boolean(draft?.fields.expires_on) && Boolean(draft?.vehicle_id || draft?.driver_id);
  const plateMismatch =
    draft?.vehicle_id &&
    draft.fields.registration_number &&
    normPlate(fleet.find((v) => v.id === draft.vehicle_id)?.license_plate) !== normPlate(draft.fields.registration_number);

  return (
    <div className="space-y-4">
      <TabRow<Tab>
        items={[
          ...(readOnly ? [] : [{ id: 'upload' as Tab, label: 'Upload' }]),
          { id: 'view' as Tab, label: 'View', count: certificates.length || undefined },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && <p className="rounded-lg bg-bad-deep/20 p-3 text-xs text-bad">{error}</p>}

      {tab === 'upload' && !readOnly && !draft && (
        <div
          {...getRootProps()}
          className={`flex min-h-[440px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition-colors ${
            isDragReject
              ? 'border-bad bg-bad-deep/10'
              : isDragActive
                ? 'border-brand bg-brand/10'
                : 'border-edge bg-panel hover:border-brand/60'
          } ${scanning ? 'pointer-events-none' : ''}`}
        >
          <input {...getInputProps()} />
          {scanning ? (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-brand" />
              <p className="mt-4 text-sm font-semibold text-ink">Reading the paper…</p>
              <p className="mt-1 text-xs text-ink-dim">A few seconds. The fields appear here for you to check.</p>
            </>
          ) : (
            <>
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-accent-y/15 text-accent-y">
                <UploadCloud className="h-8 w-8" />
              </span>
              <p className="mt-4 text-base font-semibold text-ink">
                {isDragActive ? 'Drop it here' : 'Drop the vehicle licence photo here'}
              </p>
              <p className="mt-1 text-sm text-ink-mid">or click to choose a file</p>
              <p className="mt-4 max-w-md text-xs text-ink-dim">
                JPG, PNG or WebP. The paper is read automatically — owner, registration, chassis,
                issuing state and the expiry date — and you get an alert{' '}
                {data?.warning_days ?? 7} days before it lapses. iPhone HEIC photos need saving as
                JPG first.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'upload' && !readOnly && draft && (
        <Panel
          icon={draft.id ? Pencil : ScanLine}
          title={draft.id ? 'Edit certificate' : 'What the paper says'}
          subtitle={draft.id ? 'Change what needs changing, then save.' : 'Check each value against the photo, correct anything OCR misread, then save.'}
          actions={
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-edge px-3 py-1.5 text-xs text-ink-mid hover:bg-panel-hover"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {draft.id ? 'Cancel' : 'Start over'}
            </button>
          }
        >
          {draft.scan?.fields.expires_on_source && draft.scan.fields.expires_on_source !== 'printed' && (
            <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {draft.scan.fields.expires_on_source === 'issued_plus_year'
                ? 'The expiry date was not legible; it is set to a year after issue. Check it against the paper.'
                : 'The expiry caption was not legible; the date was taken from the sticker. Check it against the paper.'}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Field</th>
                    <th className="py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {FIELDS.map((f) => (
                    <tr key={f.key}>
                      <td className="w-44 py-2 pr-3 align-middle text-ink-mid">
                        {f.label}
                        {f.key === 'expires_on' && <span className="text-bad"> *</span>}
                      </td>
                      <td className="py-1.5">
                        <input
                          type={f.type ?? 'text'}
                          value={draft.fields[f.key] ?? ''}
                          onChange={(e) =>
                            setDraft({ ...draft, fields: { ...draft.fields, [f.key]: e.target.value || null } })
                          }
                          placeholder={draft.scan ? 'Not read — type it' : ''}
                          className={INPUT}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-3 align-middle text-ink-mid">Vehicle</td>
                    <td className="py-1.5">
                      <select value={draft.vehicle_id} onChange={(e) => setDraft({ ...draft, vehicle_id: e.target.value })} className={INPUT}>
                        <option value="">— not on a tracked vehicle —</option>
                        {fleet.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.license_plate}
                            {v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}
                          </option>
                        ))}
                      </select>
                      {plateMismatch && (
                        <p className="mt-1 text-[11px] text-warn">The paper says {draft.fields.registration_number}; this vehicle is registered differently.</p>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 align-middle text-ink-mid">Driver</td>
                    <td className="py-1.5">
                      <select value={draft.driver_id} onChange={(e) => setDraft({ ...draft, driver_id: e.target.value })} className={INPUT}>
                        <option value="">— none —</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.full_name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {draft.image && (
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-ink-dim">Photo</p>
                {/* Data URL straight from the drop; next/image cannot optimise it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draft.image} alt="Vehicle licence" className="w-full rounded-lg border border-edge" />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {!canSave && (
              <span className="mr-auto text-[11px] text-ink-dim">
                {!draft.fields.expires_on ? 'An expiry date is needed — it is what the reminder runs on.' : 'Attach it to a vehicle or a driver.'}
              </span>
            )}
            <button
              type="button"
              disabled={saving || !canSave}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-good px-4 py-2 text-xs font-semibold text-accent-y-ink disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {draft.id ? 'Save changes' : 'Save certificate'}
            </button>
          </div>
        </Panel>
      )}

      {tab === 'view' && (
        <Panel
          icon={FileBadge}
          title="Vehicle licences on file"
          subtitle={`Soonest expiry first. An alert is raised ${data?.warning_days ?? 7} days before a date and again once it passes.`}
          chip={
            data && (data.expired || data.expiring) ? (
              <StatusChip tone={data.expired ? 'bad' : 'warn'} dot>
                {data.expired ? `${data.expired} expired` : `${data.expiring} expiring`}
              </StatusChip>
            ) : undefined
          }
          onRefresh={() => void load()}
          refreshing={loading}
        >
          {preview && (
            <div className="mb-4 rounded-xl border border-edge bg-panel-deep p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-mid">Certificate photo</p>
                <button type="button" onClick={() => setPreview(null)} className="rounded p-1 text-ink-mid hover:bg-divider" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.image} alt="Vehicle licence" className="mt-2 max-h-[420px] w-auto rounded-lg" />
            </div>
          )}

          {loading && !data ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-brand" />
            </div>
          ) : certificates.length === 0 ? (
            <p className="py-4 text-sm text-ink-dim">
              Nothing on file yet.{' '}
              {!readOnly && (
                <button type="button" onClick={() => setTab('upload')} className="text-brand underline-offset-2 hover:underline">
                  Upload the first one
                </button>
              )}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-ink-dim">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Vehicle</th>
                    <th className="py-2 pr-3 font-medium">Driver</th>
                    <th className="py-2 pr-3 font-medium">Issued by</th>
                    <th className="py-2 pr-3 font-medium">Expires on</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Details</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {certificates.map((c) => (
                    <tr key={c.id} className={c.status === 'expired' ? 'bg-bad-deep/10' : ''}>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-ink">{c.license_plate ?? c.registration_number ?? '—'}</p>
                        {c.license_plate && c.registration_number && normPlate(c.license_plate) !== normPlate(c.registration_number) && (
                          <p className="text-[11px] text-warn">Paper says {c.registration_number}</p>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-ink-mid">{c.driver_name ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-ink-mid">{c.issuing_state ? `${c.issuing_state} State` : '—'}</td>
                      <td className="py-2.5 pr-3 tabular-nums text-ink">
                        {longDate(c.expires_on)}
                        <span className="ml-1.5 text-[11px] text-ink-dim">{daysLabel(c)}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusChip tone={c.status === 'expired' ? 'bad' : c.status === 'expiring' ? 'warn' : 'good'} dot>
                          {c.status === 'expired' ? 'Expired' : c.status === 'expiring' ? 'Expiring' : 'Valid'}
                        </StatusChip>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-ink-dim">
                        {[c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') || '—'}
                        {c.chassis_number && <span className="block font-mono text-[10px]">{c.chassis_number}</span>}
                        {c.owner_name && <span className="block">{c.owner_name}</span>}
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="inline-flex gap-1">
                          {c.has_image && (
                            <button type="button" onClick={() => void showImage(c)} className="rounded p-1 text-ink-mid hover:bg-panel-hover" aria-label="View photo" title="View photo">
                              <ImageIcon className="h-4 w-4" />
                            </button>
                          )}
                          {!readOnly && (
                            <>
                              <button type="button" onClick={() => startEdit(c)} className="rounded p-1 text-ink-mid hover:bg-panel-hover" aria-label="Edit" title="Edit">
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button type="button" onClick={() => void remove(c)} className="rounded p-1 text-ink-mid hover:text-bad" aria-label="Delete" title="Delete">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
