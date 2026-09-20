// The live position feed: every telemetry row the TCP server writes is
// published here the instant it lands, and the dashboard's stream endpoint
// forwards it to any browser watching that customer's fleet. In-process only
// — one backend, one ingest — which is exactly this deployment.
import { EventEmitter } from 'node:events';

export interface LivePoint {
  vehicle_id: string;
  imei: string;
  license_plate: string | null;
  driver_name: string | null;
  latitude: number;
  longitude: number;
  speed_kph: number | null;
  ignition_on: boolean | null;
  fuel_level_liters: number | null;
  recorded_at: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const publishLivePoint = (customerId: string, point: LivePoint): void => {
  emitter.emit(customerId, point);
};

export const subscribeLivePoints = (
  customerId: string,
  listener: (point: LivePoint) => void
): (() => void) => {
  emitter.on(customerId, listener);
  return () => emitter.off(customerId, listener);
};
