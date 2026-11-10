'use server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { after } from 'next/server';
import { syncJobCompleted, sendGhlAlert, type GhlAlertEvent } from '@/lib/ghl';
import { getSettings } from '@/lib/auth';
import { run, must, str, num, bool, required, type ActionState } from '@/lib/actions';
import { zonedToUtc } from '@/lib/format';

// Cleaner self-service actions. Every RPC re-checks auth.uid() + assignment in the database.

/** After the response is sent, tell the GHL alerts workflow (texts the office). The cleaner never waits on it. */
function alertGhlLater(event: GhlAlertEvent, jobId: string, employeeId: string, extra?: Record<string, any>) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.GHL_ALERTS_WEBHOOK_URL) return;
  after(() => sendGhlAlert(createAdminClient(), event, { jobId, employeeId, extra }));
}

export async function onMyWay(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const jobId = required(fd, 'job_id');
    const eta = num(fd, 'eta_minutes');
    const r = must(await supabase.rpc('mark_on_my_way', { p_job: jobId, p_eta: eta })) as any;
    const { data: { user } } = await supabase.auth.getUser();
    alertGhlLater('on_my_way', jobId, user!.id, { eta_minutes: eta });
    return `The office knows you're on the way${r?.eta_minutes ? ` (about ${r.eta_minutes} min)` : ''}. Drive safe!`;
  }, ['/app']);
}

export async function acceptLocationPolicy(): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('record_location_consent'));
    return 'Thanks — policy accepted.';
  }, ['/app']);
}

export async function confirmJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('confirm_assignment', { p_job: required(fd, 'job_id') }));
    return 'Confirmed — the office can see you have this job.';
  }, ['/app']);
}

export async function clockIn(input: { jobId: string; lat: number | null; lng: number | null; accuracy: number | null; reason?: string | null }): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const rec = must(await supabase.rpc('clock_in', {
      p_job: input.jobId, p_lat: input.lat, p_lng: input.lng, p_accuracy: input.accuracy, p_exception_reason: input.reason ?? null,
    })) as any;
    const msg = rec.clock_in_location === 'verified' ? `Clocked in — location verified (${Math.round(rec.clock_in_distance_m)} m from the property).`
      : rec.clock_in_location === 'outside_geofence' ? `Clocked in, but you are ${Math.round(rec.clock_in_distance_m)} m from the property. Your manager has been notified.`
      : 'Clocked in without GPS. A manager will review your reason.';
    alertGhlLater('clock_in', input.jobId, rec.employee_id, { location: rec.clock_in_location, distance_m: rec.clock_in_distance_m });
    return { message: msg, data: rec };
  }, ['/app']);
}

export async function clockOut(input: { attendanceId: string; lat: number | null; lng: number | null; accuracy: number | null; breakMinutes: number; exception?: string | null; notes?: string | null }): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const ts = must(await supabase.rpc('clock_out', {
      p_attendance: input.attendanceId, p_lat: input.lat, p_lng: input.lng, p_accuracy: input.accuracy,
      p_break_minutes: input.breakMinutes, p_completion_exception: input.exception ?? null, p_notes: input.notes ?? null,
    })) as any;
    if (ts.job_id && process.env.SUPABASE_SERVICE_ROLE_KEY) await syncJobCompleted(createAdminClient(), ts.job_id); // GHL: tag client when the job completed
    if (ts.job_id) alertGhlLater('clock_out', ts.job_id, ts.employee_id, { total_hours: ts.total_hours });
    return { message: `Clocked out — ${Number(ts.total_hours).toFixed(2)} hours added to your timesheet.`, data: ts };
  }, ['/app']);
}

export async function saveChecklistItem(input: { jobId: string; taskId: string; completed: boolean; notes?: string | null; photoPath?: string | null }): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('save_checklist_item', {
      p_job: input.jobId, p_task: input.taskId, p_completed: input.completed, p_notes: input.notes ?? null, p_photo_path: input.photoPath ?? null,
    }));
    return '';
  }, [`/app/jobs/${input.jobId}`]);
}

export async function addJobPhoto(input: { jobId: string; kind: string; path: string; caption?: string | null }): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!['before', 'after', 'issue', 'checklist'].includes(input.kind)) throw new Error('Invalid photo type');
    if (!input.path.startsWith(`${input.jobId}/`)) throw new Error('Invalid photo path');
    must(await supabase.from('job_photos').insert({ job_id: input.jobId, employee_id: user!.id, kind: input.kind, storage_path: input.path, caption: input.caption ?? null }));
    return 'Photo saved.';
  }, [`/app/jobs/${input.jobId}`]);
}

export async function reportIssue(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('report_issue', {
      p_job: required(fd, 'job_id'), p_category: required(fd, 'category'), p_description: required(fd, 'description', 'Description'),
      p_photo_path: str(fd, 'photo_path'),
    }));
    return 'Issue sent to the office.';
  }, ['/app']);
}

export async function submitTimesheets(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const ids = fd.getAll('ids').map(String).filter(Boolean);
    if (!ids.length) throw new Error('Nothing to submit');
    const n = must(await supabase.rpc('submit_timesheets', { p_ids: ids })) as number;
    return `${n} entr${n === 1 ? 'y' : 'ies'} submitted for approval.`;
  }, ['/app']);
}

export async function requestCorrection(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { timezone } = await getSettings();
    const date = required(fd, 'date', 'Date');
    const inT = required(fd, 'clock_in', 'Start time');
    const outT = required(fd, 'clock_out', 'End time');
    must(await supabase.rpc('request_timesheet_correction', {
      p_timesheet: str(fd, 'timesheet_id'), p_job: str(fd, 'job_id'),
      p_clock_in: zonedToUtc(`${date}T${inT}`, timezone), p_clock_out: zonedToUtc(`${date}T${outT}`, timezone),
      p_break: num(fd, 'break_minutes') ?? 0, p_reason: required(fd, 'reason', 'Reason'),
    }));
    return 'Request sent. You will be notified when a manager reviews it.';
  }, ['/app']);
}

export async function requestTimeOff(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('request_time_off', {
      p_start: required(fd, 'start_date', 'Start date'), p_end: required(fd, 'end_date', 'End date'),
      p_kind: str(fd, 'kind') ?? 'personal', p_reason: str(fd, 'reason'),
    }));
    return 'Request sent to your manager.';
  }, ['/app']);
}

export async function cancelTimeOff(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('cancel_time_off', { p_id: required(fd, 'id') }));
    return 'Request cancelled.';
  }, ['/app']);
}

export async function updateMyProfile(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('update_my_profile', {
      p_full_name: required(fd, 'full_name', 'Name'), p_phone: str(fd, 'phone'), p_address: str(fd, 'address'),
      p_emergency_name: str(fd, 'emergency_contact_name'), p_emergency_phone: str(fd, 'emergency_contact_phone'),
      p_email_notifications: bool(fd, 'email_notifications'),
      p_mailing_address: str(fd, 'mailing_address'), p_emergency_relationship: str(fd, 'emergency_contact_relationship'),
    }));
    return 'Profile updated.';
  }, ['/app']);
}

export async function changePassword(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const pw = required(fd, 'password', 'Password');
    if (pw.length < 10) throw new Error('Use at least 10 characters');
    if (pw !== fd.get('confirm')) throw new Error('Passwords do not match');
    const supabase = await createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) throw error;
    return 'Password changed.';
  }, []);
}
