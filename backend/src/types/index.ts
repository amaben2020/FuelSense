/** Chooses the dashboard's landing view; every role has the whole app. */
export type FleetRole = 'manager' | 'commander';

export interface JwtPayload {
  customerId: string;
  email: string;
  name?: string;
  /** Absent on tokens issued before roles existed — those are the manager's. */
  role?: FleetRole;
  /** Set when the token belongs to a fleet user rather than the account holder. */
  userId?: string;
  iat?: number;
  exp?: number;
}

export interface DriverJwtPayload {
  role: 'driver';
  driverId: string;
  customerId: string;
  driverCode: string;
  name: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request to include authenticated user and driver
declare global {
  namespace Express {
    interface Request {
      user: JwtPayload;
      driver: DriverJwtPayload;
    }
  }
}
