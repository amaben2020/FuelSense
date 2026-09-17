import { describe, it, expect } from '@jest/globals';
import { parseVioCertificateText } from '../src/lib/vio-certificate';

// Verbatim OCR.space output for a photographed Nasarawa State vehicle
// licence (2026-09-17). The left stub reads cleanly; the right-hand sticker
// is garbled, loses the "Expiry" caption, and misreads the plate as
// ABC182PA — which is exactly what the parser has to cope with.
const NASARAWA = `Owner's Name:
UZOCHUKWU BENNETH
Address:
AFTER HIGH TENSION BET 9JA
AUGBANA ONE MAN VILLAGE
File Number
13534699
Registration Number:
ABC782PA
Engine Number:
NA
Chassis Number:
JTMYFREV7DD009447
Vehicle Make
Toyota
License Fee:
₩ 2500
Date:
03/12/2025
REMOVE THIS PORTION
NASARAWA STATE VE
PRIVATE CAR
DEC 2026
02512035777
Number ABC182PA
ngine Number NA
Chassis Number: JTMYFREV7DD009
Vehicle Makg: Toyota,
/ehicle
Model:
RAY
Color: Custon
PALL
Engine Capacity: 24403.0
cantact on Dar 03/Dec/2025
Biter Sued 034212933
Date: 03/12/2026
paid 1500 fee for Radio
DELICENS
REMOVE THIS PORTION`;

describe('VIO certificate parser', () => {
  const f = parseVioCertificateText(NASARAWA);

  it('trusts the stub over the sticker for identity fields', () => {
    expect(f.owner_name).toBe('UZOCHUKWU BENNETH');
    expect(f.owner_address).toBe('AFTER HIGH TENSION BET 9JA, AUGBANA ONE MAN VILLAGE');
    expect(f.file_number).toBe('13534699');
    expect(f.registration_number).toBe('ABC782PA');
    expect(f.chassis_number).toBe('JTMYFREV7DD009447');
    expect(f.vehicle_make).toBe('Toyota');
    expect(f.engine_number).toBeNull();
  });

  it('reads the issuing state and vehicle type from the sticker', () => {
    expect(f.issuing_state).toBe('Nasarawa');
    expect(f.vehicle_type).toBe('Private Car');
  });

  it('reads dates day-first and finds the expiry without its caption', () => {
    expect(f.issued_on).toBe('2025-12-03');
    expect(f.expires_on).toBe('2026-12-03');
    expect(f.expires_on_source).toBe('sticker');
  });

  it('takes a captioned expiry when the paper prints one', () => {
    const g = parseVioCertificateText('Date Issued: 01/02/2026\nExpiry Date: 01/02/2027');
    expect(g.issued_on).toBe('2026-02-01');
    expect(g.expires_on).toBe('2027-02-01');
    expect(g.expires_on_source).toBe('printed');
  });

  it('assumes twelve months when only an issue date survives OCR', () => {
    const g = parseVioCertificateText('Registration Number:\nKUJ123AB\nDate:\n15/06/2026');
    expect(g.expires_on).toBe('2027-06-15');
    expect(g.expires_on_source).toBe('issued_plus_year');
  });

  it('returns nothing rather than guessing from an unreadable photo', () => {
    const g = parseVioCertificateText('PALL\nDELICENS');
    expect(g.registration_number).toBeNull();
    expect(g.expires_on).toBeNull();
  });
});
