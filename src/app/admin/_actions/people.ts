'use server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import { run, must, str, num, bool, required, type ActionState } from '@/lib/actions';

const ROLES = ['owner', 'ops_manager', 'office_admin', 'cleaner'];

async function requireOwner() {
  const me = await getCurrentUser();
  if (me?.role !== 'owner') throw new Error('Only the owner can do this.');
  return me;
}

/** Creates a login for a new employee. Role is stored in app_metadata (not user-editable). */
export async function createEmployee(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requireOwner();
    const email = required(fd, 'email', 'Email').toLowerCase();
    const full_name = required(fd, 'full_name', 'Full name');
    const role = str(fd, 'role') ?? 'cleaner';
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    const tempPassword = str(fd, 'temp_password');
    if (tempPassword && tempPassword.length < 10) throw new Error('Temporary password must be at least 10 characters');

    const admin = createAdminClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    let userId: string;
    if (tempPassword) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: tempPassword, email_confirm: true,
        app_metadata: { role }, user_metadata: { full_name, phone: str(fd, 'phone') },
      });
      if (error) throw error;
      userId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name, phone: str(fd, 'phone') }, redirectTo: `${site}/auth/confirm?next=/auth/set-password`,
      });
      if (error) throw error;
      userId = data.user.id;
      await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
    }
    // trigger created users + employee_profiles rows; set role + HR details
    must(await admin.from('users').update({ role_key: role, phone: str(fd, 'phone') }).eq('id', userId));
    must(await admin.from('employee_profiles').update({
      job_title: str(fd, 'job_title') ?? (role === 'cleaner' ? 'Housekeeper' : 'Office'),
      pay_rate: num(fd, 'pay_rate') ?? 0,
      hire_date: str(fd, 'hire_date'),
      team: str(fd, 'team'),
      employee_number: str(fd, 'employee_number'),
      employment_type: str(fd, 'employment_type') ?? 'hourly_employee',
      employment_status: 'onboarding',
    }).eq('user_id', userId));
    await admin.from('audit_logs').insert({ actor_id: (await getCurrentUser())?.id, action: 'create_login', entity: 'users', entity_id: userId, details: { email, role } });
    return {
      message: tempPassword ? 'Employee created. Share the temporary password securely; they can change it after signing in.' : 'Invitation email sent.',
      data: { id: userId },
    };
  }, ['/admin/employees']);
}

export async function updateEmployeeProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const id = required(fd, 'user_id');
    must(await supabase.from('users').update({ full_name: required(fd, 'full_name', 'Name'), phone: str(fd, 'phone') }).eq('id', id));
    must(await supabase.from('employee_profiles').update({
      job_title: str(fd, 'job_title') ?? 'Housekeeper',
      employment_status: str(fd, 'employment_status') ?? 'active',
      hire_date: str(fd, 'hire_date'), team: str(fd, 'team'), employee_number: str(fd, 'employee_number'),
      address: str(fd, 'address'), home_latitude: num(fd, 'home_latitude'), home_longitude: num(fd, 'home_longitude'),
      emergency_contact_name: str(fd, 'emergency_contact_name'), emergency_contact_phone: str(fd, 'emergency_contact_phone'),
      emergency_contact_relationship: str(fd, 'emergency_contact_relationship'),
      mailing_address: bool(fd, 'mailing_same') ? str(fd, 'address') : str(fd, 'mailing_address'),
      background_check_status: str(fd, 'background_check_status') ?? 'not_started',
      background_check_date: str(fd, 'background_check_date'),
    }).eq('user_id', id));
    return 'Profile saved.';
  }, ['/admin/employees']);
}

/** Parses deduction lines: "Uniform | fixed | 10" or "Retirement | percent | 3" */
function parseDeductions(text: string | null) {
  if (!text) return [];
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [name, type, amount] = line.split('|').map((s) => s.trim());
    const amt = Number(amount);
    if (!name || !['fixed', 'percent'].includes(type) || !Number.isFinite(amt) || amt < 0) {
      throw new Error(`Deduction line "${line}" must look like: Name | fixed | 10   or   Name | percent | 3`);
    }
    return { name, type, amount: amt };
  });
}

export async function updateCompensation(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requireOwner();
    const supabase = await createClient();
    const rate = num(fd, 'pay_rate');
    if (rate == null || rate < 0) throw new Error('Pay rate must be zero or more');
    must(await supabase.from('employee_profiles').update({
      pay_rate: rate,
      employment_type: required(fd, 'employment_type'),
      pay_frequency: str(fd, 'pay_frequency'),
      overtime_eligible: bool(fd, 'overtime_eligible'),
      overtime_weekly_threshold: num(fd, 'overtime_weekly_threshold'),
      overtime_daily_threshold: num(fd, 'overtime_daily_threshold'),
      overtime_multiplier: num(fd, 'overtime_multiplier'),
      deductions: parseDeductions(str(fd, 'deductions')),
    }).eq('user_id', required(fd, 'user_id')));
    return 'Compensation updated. New rate applies to shifts clocked from now on.';
  }, ['/admin/employees']);
}

export async function updateAccess(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const me = await requireOwner();
    const id = required(fd, 'user_id');
    const role = required(fd, 'role');
    if (!ROLES.includes(role)) throw new Error('Invalid role');
    const active = fd.get('is_active') === 'true';
    if (id === me.id && (!active || role !== 'owner')) throw new Error('You cannot remove your own owner access.');
    const supabase = await createClient();
    must(await supabase.from('users').update({ role_key: role, is_active: active }).eq('id', id));
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(id, { app_metadata: { role }, ban_duration: active ? 'none' : '876000h' });
    return active ? 'Access updated.' : 'Account deactivated; the employee can no longer sign in.';
  }, ['/admin/employees']);
}

export async function sendPasswordReset(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    const { error } = await supabase.auth.resetPasswordForEmail(required(fd, 'email'), { redirectTo: `${site}/auth/confirm?next=/auth/set-password` });
    if (error) throw error;
    return 'Password reset email sent.';
  }, []);
}

export async function saveOnboarding(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const items = fd.getAll('item').map(String);
    const done = new Set(fd.getAll('done').map(String));
    const extra = str(fd, 'new_item');
    const list = items.map((item) => ({ item, done: done.has(item) }));
    if (extra) list.push({ item: extra, done: false });
    must(await supabase.from('employee_profiles').update({ onboarding_checklist: list }).eq('user_id', required(fd, 'user_id')));
    return 'Onboarding checklist saved.';
  }, ['/admin/employees']);
}

export async function addRecord(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const field = required(fd, 'field');
    if (!['training_records', 'certifications'].includes(field)) throw new Error('Invalid field');
    const id = required(fd, 'user_id');
    const { data } = await supabase.from('employee_profiles').select(field).eq('user_id', id).single();
    const list = [...(((data as any)?.[field]) ?? []), {
      name: required(fd, 'name', 'Name'), date: str(fd, 'date'), expires: str(fd, 'expires'), notes: str(fd, 'notes'),
    }];
    must(await supabase.from('employee_profiles').update({ [field]: list }).eq('user_id', id));
    return 'Record added.';
  }, ['/admin/employees']);
}

export async function addPerformanceNote(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    must(await supabase.from('employee_performance_notes').insert({
      employee_id: required(fd, 'user_id'), author_id: user?.id, rating: num(fd, 'rating'), note: required(fd, 'note', 'Note'),
    }));
    return 'Note added.';
  }, ['/admin/employees']);
}

export async function uploadDocument(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const employee = required(fd, 'user_id');
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) throw new Error('Choose a file to upload');
    if (file.size > 15 * 1024 * 1024) throw new Error('File must be under 15 MB');
    const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `${employee}/${crypto.randomUUID()}-${safe}`;
    const up = await supabase.storage.from('employee-documents').upload(path, file, { contentType: file.type });
    if (up.error) throw up.error;
    must(await supabase.from('employee_documents').insert({
      employee_id: employee, name: str(fd, 'name') ?? file.name, category: str(fd, 'category') ?? 'other',
      storage_path: path, expires_on: str(fd, 'expires_on'), uploaded_by: user?.id,
    }));
    return 'Document uploaded.';
  }, ['/admin/employees']);
}

export async function deleteDocument(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const id = required(fd, 'id');
    const { data } = await supabase.from('employee_documents').select('storage_path').eq('id', id).single();
    if (data) await supabase.storage.from('employee-documents').remove([data.storage_path]);
    must(await supabase.from('employee_documents').delete().eq('id', id));
    return 'Document deleted.';
  }, ['/admin/employees']);
}

export async function addAvailability(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const days = fd.getAll('weekday').map(Number);
    if (!days.length) throw new Error('Pick at least one day');
    const start = required(fd, 'start_time', 'Start'), end = required(fd, 'end_time', 'End');
    if (end <= start) throw new Error('End must be after start');
    must(await supabase.from('employee_availability').insert(days.map((weekday) => ({
      employee_id: required(fd, 'user_id'), weekday, start_time: start, end_time: end, notes: str(fd, 'notes'),
    }))));
    return 'Availability saved.';
  }, ['/admin/employees', '/app/time-off']);
}

export async function removeAvailability(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.from('employee_availability').delete().eq('id', required(fd, 'id')));
    return 'Removed.';
  }, ['/admin/employees', '/app/time-off']);
}

export async function reviewTimeOff(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const affected = must(await supabase.rpc('review_time_off', {
      p_id: required(fd, 'id'), p_approve: fd.get('decision') === 'approve', p_notes: str(fd, 'notes'),
    })) as number;
    return affected ? `Approved. ${affected} scheduled job(s) now need a replacement cleaner.` : 'Decision saved; the employee was notified.';
  }, ['/admin']);
}

export async function createAnnouncement(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    must(await supabase.from('announcements').insert({
      title: required(fd, 'title', 'Title'), body: required(fd, 'body', 'Message'),
      audience: str(fd, 'audience') ?? 'all', pinned: bool(fd, 'pinned'), created_by: user?.id,
    }));
    return 'Announcement published and notifications sent.';
  }, ['/admin/announcements', '/app']);
}

export async function deleteAnnouncement(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.from('announcements').delete().eq('id', required(fd, 'id')));
    return 'Announcement removed.';
  }, ['/admin/announcements', '/app']);
}

export async function markNotificationsRead(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const id = str(fd, 'id');
    let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (id) q = q.eq('id', id);
    must(await q);
    return id ? '' : 'All caught up.';
  }, ['/admin', '/app']);
}
