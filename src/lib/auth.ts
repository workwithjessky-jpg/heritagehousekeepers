import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

export type Role = 'owner' | 'ops_manager' | 'office_admin' | 'cleaner';
export const STAFF: Role[] = ['owner', 'ops_manager', 'office_admin'];
export const SUPERVISORS: Role[] = ['owner', 'ops_manager'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  ops_manager: 'Operations Manager',
  office_admin: 'Office Administrator',
  cleaner: 'Cleaner',
};

export interface CurrentUser {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  phone: string | null;
}

export interface Settings {
  company_name: string;
  timezone: string;
  currency: string;
  [key: string]: any;
}

/** Signed-in user + profile, deduplicated per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('users').select('id,email,full_name,role_key,phone,is_active').eq('id', user.id).single();
  if (!data || !data.is_active) return null;
  return { id: data.id, email: data.email, full_name: data.full_name, role: data.role_key as Role, phone: data.phone };
});

export const getSettings = cache(async (): Promise<Settings> => {
  const supabase = await createClient();
  const { data } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  return (data ?? { company_name: 'Heritage Housekeepers', timezone: 'America/New_York', currency: 'USD' }) as Settings;
});

/** Page guard: redirects to login, or to the correct portal for the user's role. */
export async function requireRole(roles: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!roles.includes(user.role)) redirect(user.role === 'cleaner' ? '/app' : '/admin');
  return user;
}

export const isStaff = (r: Role) => STAFF.includes(r);
export const isSupervisor = (r: Role) => SUPERVISORS.includes(r);
