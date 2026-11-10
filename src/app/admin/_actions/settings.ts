'use server';
import { createClient } from '@/lib/supabase/server';
import { run, must, str, num, bool, required, type ActionState } from '@/lib/actions';

const lines = (s: string | null) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

export async function saveSettings(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const section = required(fd, 'section');
    let patch: Record<string, any> = {};
    switch (section) {
      case 'company':
        patch = {
          company_name: required(fd, 'company_name', 'Company name'), company_email: str(fd, 'company_email'),
          company_phone: str(fd, 'company_phone'), company_address: str(fd, 'company_address'),
          timezone: required(fd, 'timezone', 'Time zone'), currency: required(fd, 'currency', 'Currency').toUpperCase(),
        };
        try { new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone }); } catch { throw new Error('Unknown time zone (use e.g. America/New_York)'); }
        break;
      case 'payroll':
        patch = {
          jurisdiction: required(fd, 'jurisdiction', 'Jurisdiction'),
          pay_frequency: required(fd, 'pay_frequency'), pay_period_anchor: required(fd, 'pay_period_anchor', 'Period start'),
          payday_offset_days: num(fd, 'payday_offset_days') ?? 5,
          overtime_enabled: bool(fd, 'overtime_enabled'),
          overtime_weekly_threshold: num(fd, 'overtime_weekly_threshold'),
          overtime_daily_threshold: num(fd, 'overtime_daily_threshold'),
          overtime_multiplier: num(fd, 'overtime_multiplier') ?? 1.5,
          auto_break_enabled: bool(fd, 'auto_break_enabled'),
          auto_break_after_hours: num(fd, 'auto_break_after_hours') ?? 6,
          auto_break_minutes: num(fd, 'auto_break_minutes') ?? 30,
        };
        if (patch.overtime_enabled && !patch.overtime_weekly_threshold && !patch.overtime_daily_threshold) {
          throw new Error('Set a daily and/or weekly overtime threshold, or turn overtime off.');
        }
        break;
      case 'attendance':
        patch = {
          default_geofence_m: num(fd, 'default_geofence_m') ?? 150,
          late_grace_minutes: num(fd, 'late_grace_minutes') ?? 10,
          missed_clock_in_minutes: num(fd, 'missed_clock_in_minutes') ?? 20,
          forgot_clock_out_minutes: num(fd, 'forgot_clock_out_minutes') ?? 60,
          max_shift_hours: num(fd, 'max_shift_hours') ?? 10,
          max_weekly_hours_alert: num(fd, 'max_weekly_hours_alert') ?? 45,
          min_travel_buffer_minutes: num(fd, 'min_travel_buffer_minutes') ?? 20,
          avg_travel_speed_kmh: num(fd, 'avg_travel_speed_kmh') ?? 35,
          require_before_after_photos: bool(fd, 'require_before_after_photos'),
          location_policy_text: required(fd, 'location_policy_text', 'Location policy'),
        };
        break;
      case 'notifications': {
        const events = ['on_my_way', 'clock_in', 'clock_out', 'geofence', 'missed_clock_in', 'forgot_clock_out', 'timesheet_submitted', 'time_off', 'issue', 'job_completed', 'photos', 'schedule_change'];
        patch = {
          notification_prefs: {
            email_enabled: bool(fd, 'email_enabled'),
            events: Object.fromEntries(events.map((e) => [e, bool(fd, `ev_${e}`)])),
          },
        };
        break;
      }
      case 'catalog': {
        const pricing = lines(str(fd, 'service_pricing')).map((l) => {
          const [service, price, unit] = l.split('|').map((s) => s.trim());
          if (!service || Number.isNaN(Number(price))) throw new Error(`Pricing line "${l}" must look like: Deep Clean | 250 | per visit`);
          return { service, price: Number(price), unit: unit || 'per visit' };
        });
        const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const hours = Object.fromEntries(days.map((d) => {
          const o = str(fd, `${d}_open`), c = str(fd, `${d}_close`);
          return [d, o && c ? [o, c] : null];
        }));
        patch = { job_types: lines(str(fd, 'job_types')), service_pricing: pricing, operating_hours: hours };
        if (!patch.job_types.length) throw new Error('Keep at least one job type');
        break;
      }
      default:
        throw new Error('Unknown settings section');
    }
    patch.updated_at = new Date().toISOString();
    must(await supabase.from('company_settings').update(patch).eq('id', 1));
    return 'Settings saved.';
  }, ['/']);
}

// ------------------------------------------------------------------ checklist templates
export async function createChecklist(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const row = must(await supabase.from('cleaning_checklists').insert({
      name: required(fd, 'name', 'Name'), cleaning_type: required(fd, 'cleaning_type', 'Cleaning type'), description: str(fd, 'description'),
    }).select('id').single());
    const copyFrom = str(fd, 'copy_from');
    if (copyFrom) {
      const { data: tasks } = await supabase.from('checklist_tasks').select('area,task,sort_order,is_required,requires_photo').eq('checklist_id', copyFrom);
      if (tasks?.length) must(await supabase.from('checklist_tasks').insert(tasks.map((t: any) => ({ ...t, checklist_id: row.id }))));
    }
    return { message: 'Checklist created.', data: { id: row.id } };
  }, ['/admin/checklists']);
}

export async function updateChecklist(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.from('cleaning_checklists').update({
      name: required(fd, 'name', 'Name'), cleaning_type: required(fd, 'cleaning_type'), description: str(fd, 'description'),
      is_active: bool(fd, 'is_active'),
    }).eq('id', required(fd, 'id')));
    return 'Checklist saved.';
  }, ['/admin/checklists']);
}

export async function addTask(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.from('checklist_tasks').insert({
      checklist_id: required(fd, 'checklist_id'), area: required(fd, 'area', 'Area'), task: required(fd, 'task', 'Task'),
      sort_order: num(fd, 'sort_order') ?? 100, is_required: bool(fd, 'is_required'), requires_photo: bool(fd, 'requires_photo'),
    }));
    return 'Task added.';
  }, ['/admin/checklists']);
}

export async function updateTask(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const id = required(fd, 'id');
    if (fd.get('delete') === '1') {
      must(await supabase.from('checklist_tasks').delete().eq('id', id));
      return 'Task removed.';
    }
    must(await supabase.from('checklist_tasks').update({
      area: required(fd, 'area'), task: required(fd, 'task'), sort_order: num(fd, 'sort_order') ?? 0,
      is_required: bool(fd, 'is_required'), requires_photo: bool(fd, 'requires_photo'),
    }).eq('id', id));
    return 'Task saved.';
  }, ['/admin/checklists']);
}
