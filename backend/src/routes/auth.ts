import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import {
  db,
  customers,
  customerPublicSelect,
  eq,
  sql,
} from '../lib/db-helpers';
import { signToken, signFleetUserToken, authenticateCustomer } from '../middleware/auth';
import { logAndRespond } from '../lib/errors';
import { fleetUsers, FLEET_ROLES, type FleetRole } from '../db/schema';
import { and, desc } from 'drizzle-orm';

/**
 * Who is signed in, alongside the fleet they belong to. The manager is the
 * customer row itself; a fleet user carries their own name, role and title
 * so the dashboard can open on their view and sign their actions.
 */
const signedInUser = (
  customer: { name: string; email: string },
  user?: { role: FleetRole; name: string; email: string; title: string | null }
) =>
  user
    ? { role: user.role, name: user.name, email: user.email, title: user.title }
    : { role: 'manager' as FleetRole, name: customer.name, email: customer.email, title: null };

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

router.post('/register', authLimiter, async (req: Request, res: Response) => {
  const { name, email, password, companyName, phone } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    companyName?: string;
    phone?: string;
  };

  if (!name?.trim() || !email?.trim() || !password) {
    res.status(400).json({ error: 'Name, email, and password are required' });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const [existing] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email.toLowerCase().trim()));

    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [customer] = await db
      .insert(customers)
      .values({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        companyName: companyName?.trim() || null,
        phone: phone?.trim() || null,
      })
      .returning(customerPublicSelect);

    const token = signToken(customer as Parameters<typeof signToken>[0]);
    res.status(201).json({ token, customer });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email?.trim() || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const [customer] = await db
      .select({
        ...customerPublicSelect,
        password_hash: customers.passwordHash,
      })
      .from(customers)
      .where(eq(customers.email, email.toLowerCase().trim()));

    if (!customer) {
      // Not the account holder — perhaps one of the people the fleet lets in.
      const [user] = await db
        .select({
          id: fleetUsers.id,
          customerId: fleetUsers.customerId,
          email: fleetUsers.email,
          name: fleetUsers.name,
          role: fleetUsers.role,
          title: fleetUsers.title,
          passwordHash: fleetUsers.passwordHash,
        })
        .from(fleetUsers)
        .where(and(eq(fleetUsers.email, email.toLowerCase().trim()), eq(fleetUsers.isActive, true)));
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      const [fleet] = await db
        .select(customerPublicSelect)
        .from(customers)
        .where(eq(customers.id, user.customerId));
      if (!fleet) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }
      const role = user.role as FleetRole;
      await db.update(fleetUsers).set({ lastLoginAt: sql`NOW()` }).where(eq(fleetUsers.id, user.id));
      const token = signFleetUserToken({ ...user, role });
      const me = signedInUser(fleet, { ...user, role });
      res.json({ token, customer: { ...fleet, ...me, user: me } });
      return;
    }

    const valid = await bcrypt.compare(password, customer.password_hash as string);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    await db.update(customers).set({ lastLoginAt: sql`NOW()` }).where(eq(customers.id, customer.id));

    const { password_hash: _ph, ...customerData } = customer;
    const token = signToken(customerData as Parameters<typeof signToken>[0]);
    const me = signedInUser(customerData);
    res.json({ token, customer: { ...customerData, role: me.role, user: me } });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * The people this fleet lets in, managed by the account holder or a manager.
 *
 * The account holder signs in on the customer row and has no fleet_users row,
 * so `req.user.userId` is unset for them; a fleet user has one. Either way the
 * role on the token decides: only a manager adds or removes people, so a
 * commander cannot quietly grant themselves a second login and a viewer is
 * already refused by the middleware before reaching here.
 */
const requireManager = (req: Request, res: Response): boolean => {
  if (req.user.role !== 'manager') {
    res.status(403).json({ error: 'Only a manager can manage who signs in.' });
    return false;
  }
  return true;
};

const teamMemberSelect = {
  id: fleetUsers.id,
  email: fleetUsers.email,
  name: fleetUsers.name,
  role: fleetUsers.role,
  title: fleetUsers.title,
  is_active: fleetUsers.isActive,
  created_at: fleetUsers.createdAt,
};

router.get('/team', authenticateCustomer, async (req: Request, res: Response) => {
  try {
    const members = await db
      .select(teamMemberSelect)
      .from(fleetUsers)
      .where(eq(fleetUsers.customerId, req.user.customerId))
      .orderBy(desc(fleetUsers.createdAt));
    res.json({ members });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.post('/team', authenticateCustomer, async (req: Request, res: Response) => {
  if (!requireManager(req, res)) return;

  const body = (req.body ?? {}) as {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    title?: string;
  };
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = String(body.role ?? 'viewer') as FleetRole;
  const title = String(body.title ?? '').trim() || null;

  if (!name || !email || !password) {
    res.status(400).json({ error: 'Name, email and a password are required.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'That email address does not look right.' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  if (!FLEET_ROLES.includes(role)) {
    res.status(400).json({ error: `Role must be one of: ${FLEET_ROLES.join(', ')}.` });
    return;
  }

  try {
    // One address signs in as one person. The account holder's own email is
    // reserved too, or a second login could be created for it here.
    const [takenByFleet] = await db
      .select({ id: fleetUsers.id })
      .from(fleetUsers)
      .where(eq(fleetUsers.email, email))
      .limit(1);
    const [takenByAccount] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, email))
      .limit(1);
    if (takenByFleet || takenByAccount) {
      res.status(409).json({ error: 'Someone already signs in with that email.' });
      return;
    }

    const [member] = await db
      .insert(fleetUsers)
      .values({
        customerId: req.user.customerId,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        name,
        role,
        title,
      })
      .returning(teamMemberSelect);
    res.status(201).json({ member });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/** Deactivating rather than deleting keeps the name on every action they signed. */
router.patch('/team/:id', authenticateCustomer, async (req: Request, res: Response) => {
  if (!requireManager(req, res)) return;

  const body = (req.body ?? {}) as { is_active?: boolean; role?: string };
  const patch: Partial<{ isActive: boolean; role: string }> = {};
  if (typeof body.is_active === 'boolean') patch.isActive = body.is_active;
  if (body.role != null) {
    if (!FLEET_ROLES.includes(body.role as FleetRole)) {
      res.status(400).json({ error: `Role must be one of: ${FLEET_ROLES.join(', ')}.` });
      return;
    }
    patch.role = body.role;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nothing to change.' });
    return;
  }
  if (req.user.userId === String(req.params.id) && patch.role && patch.role !== 'manager') {
    res.status(400).json({ error: 'You cannot demote your own login.' });
    return;
  }

  try {
    const [member] = await db
      .update(fleetUsers)
      .set(patch)
      .where(and(eq(fleetUsers.id, String(req.params.id)), eq(fleetUsers.customerId, req.user.customerId)))
      .returning(teamMemberSelect);
    if (!member) {
      res.status(404).json({ error: 'No such person on this fleet.' });
      return;
    }
    res.json({ member });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.get('/me', authenticateCustomer, async (req: Request, res: Response) => {
  try {
    const [customer] = await db
      .select(customerPublicSelect)
      .from(customers)
      .where(eq(customers.id, req.user.customerId));

    if (!customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    let me = signedInUser(customer);
    if (req.user.userId) {
      const [user] = await db
        .select({
          role: fleetUsers.role,
          name: fleetUsers.name,
          email: fleetUsers.email,
          title: fleetUsers.title,
        })
        .from(fleetUsers)
        .where(eq(fleetUsers.id, req.user.userId));
      if (user) me = signedInUser(customer, { ...user, role: user.role as FleetRole });
    }
    res.json({ ...customer, role: me.role, user: me });
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

/**
 * White-label branding.
 *
 * A fleet operator reselling this to their own customers, or simply wanting
 * their own name over the door, sets a logo and accent colour here. Both are
 * optional; anything unset falls back to FuelSense's own mark, so a fresh
 * account still looks finished.
 */
router.patch('/branding', authenticateCustomer, async (req: Request, res: Response) => {
  const { logo_url: logoUrl, brand_color: brandColor, company_name: companyName } =
    req.body as { logo_url?: string | null; brand_color?: string | null; company_name?: string };

  // An arbitrary string here ends up in an <img src> on every page, so only
  // plain http(s) URLs are accepted — no data: or javascript: payloads.
  if (logoUrl && !/^https?:\/\/[^\s]+$/i.test(logoUrl)) {
    res.status(400).json({ error: 'logo_url must be an http(s) URL' });
    return;
  }

  if (brandColor && !/^#[0-9a-f]{3,8}$/i.test(brandColor)) {
    res.status(400).json({ error: 'brand_color must be a hex colour like #00e599' });
    return;
  }

  try {
    const [customer] = await db
      .update(customers)
      .set({
        ...(logoUrl !== undefined ? { logoUrl: logoUrl || null } : {}),
        ...(brandColor !== undefined ? { brandColor: brandColor || null } : {}),
        ...(companyName !== undefined ? { companyName: companyName?.trim() || null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, req.user.customerId))
      .returning(customerPublicSelect);

    res.json(customer);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

router.patch('/onboarding', authenticateCustomer, async (req: Request, res: Response) => {
  try {
    const [customer] = await db
      .update(customers)
      .set({ onboardingCompleted: true, updatedAt: new Date() })
      .where(eq(customers.id, req.user.customerId))
      .returning(customerPublicSelect);

    res.json(customer);
  } catch (error) {
    logAndRespond(res, req.path, error);
  }
});

export default router;
