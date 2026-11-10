'use server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { syncJobCompleted } from '@/lib/ghl';
import { getSettings } from '@/lib/auth';
import { run, must, str, num, bool, required, type ActionState } from '@/lib/actions';
import { zonedToUtc } from '@/lib/format';

async function times(fd: FormData) {
  const { timezone } = await getSettings();
  const date = required(fd, 'date', 'Date');
  const startT = required(fd, 'start_time', 'Start time');
  const endT = required(fd, 'end_time', 'End time');
  const start = zonedToUtc(`${date}T${startT}`, timezone);
  const end = zonedToUtc(`${date}T${endT}`, timezone);
  if (new Date(end) <= new Date(start)) throw new Error('End time must be after start time');
  return { start, end };
}

export async function createJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { start, end } = await times(fd);
    const rule = str(fd, 'recurrence_rule') ?? 'none';
    const occurrences = rule === 'none' ? 1 : Math.min(Math.max(num(fd, 'occurrences') ?? 4, 1), 52);
    const ids = must(await supabase.rpc('create_job_series', {
      p_job: {
        property_id: required(fd, 'property_id', 'Property'),
        checklist_id: str(fd, 'checklist_id'),
        title: required(fd, 'title', 'Title'),
        cleaning_type: required(fd, 'cleaning_type', 'Cleaning type'),
        scheduled_start: start, scheduled_end: end,
        price: str(fd, 'price'), instructions: str(fd, 'instructions'),
        recurrence_rule: rule, parent_job_id: str(fd, 'parent_job_id'),
      },
      p_occurrences: occurrences,
    })) as string[];

    const cleaners = fd.getAll('cleaners').map(String).filter(Boolean);
    const lead = str(fd, 'team_lead');
    const problems: string[] = [];
    for (const jobId of ids) {
      for (const emp of cleaners) {
        const { data, error } = await supabase.rpc('assign_employee', { p_job: jobId, p_employee: emp, p_team_lead: emp === lead, p_force: false });
        if (error) problems.push(error.message);
        else if (data?.warnings?.length) problems.push(...data.warnings);
      }
    }
    const uniq = [...new Set(problems)];
    return {
      message: `Created ${ids.length} job${ids.length > 1 ? 's' : ''}.${uniq.length ? ' Notes: ' + uniq.slice(0, 3).join(' ') : ''}`,
      data: { id: ids[0] },
    };
  }, ['/admin']);
}

export async function updateJob(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const id = required(fd, 'id');
    const { start, end } = await times(fd);
    must(await supabase.from('cleaning_jobs').update({
      title: required(fd, 'title', 'Title'),
      cleaning_type: required(fd, 'cleaning_type', 'Cleaning type'),
      checklist_id: str(fd, 'checklist_id'),
      price: num(fd, 'price'),
      instructions: str(fd, 'instructions'),
      scheduled_start: start,
      scheduled_end: end,
    }).eq('id', id));
    return 'Job updated. Assigned cleaners were notified of any time change.';
  }, ['/admin']);
}

export async function setJobStatus(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const status = required(fd, 'status');
    if (!['scheduled', 'assigned', 'confirmed', 'needs_attention', 'cancelled', 'completed'].includes(status)) throw new Error('Invalid status');
    const patch: Record<string, any> = { status };
    if (status === 'cancelled') {
      patch.cancelled_reason = required(fd, 'reason', 'Cancellation reason');
    }
    if (status === 'completed') patch.completed_at = new Date().toISOString();
    must(await supabase.from('cleaning_jobs').update(patch).eq('id', required(fd, 'id')));
    if (status === 'completed') await syncJobCompleted(createAdminClient(), required(fd, 'id'));
    return status === 'cancelled' ? 'Job cancelled and cleaners notified.' : 'Status updated.';
  }, ['/admin']);
}

export async function cancelSeries(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const group = required(fd, 'recurrence_group_id');
    const reason = required(fd, 'reason', 'Cancellation reason');
    const res = must(await supabase.from('cleaning_jobs')
      .update({ status: 'cancelled', cancelled_reason: reason })
      .eq('recurrence_group_id', group).gte('scheduled_start', new Date().toISOString())
      .in('status', ['scheduled', 'assigned', 'confirmed', 'needs_attention']).select('id'));
    return `Cancelled ${res?.length ?? 0} upcoming job(s) in the series.`;
  }, ['/admin']);
}

export async function assignCleaner(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const data = must(await supabase.rpc('assign_employee', {
      p_job: required(fd, 'job_id'), p_employee: required(fd, 'employee_id', 'Cleaner'),
      p_team_lead: bool(fd, 'team_lead'), p_force: bool(fd, 'force'),
    })) as any;
    const w = [...(data?.overridden ?? []), ...(data?.warnings ?? [])];
    return w.length ? `Assigned with warnings: ${w.join(' ')}` : 'Cleaner assigned and notified.';
  }, ['/admin']);
}

export async function unassignCleaner(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('unassign_employee', { p_job: required(fd, 'job_id'), p_employee: required(fd, 'employee_id') }));
    return 'Cleaner removed from job.';
  }, ['/admin']);
}

export async function replaceCleaner(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const job = required(fd, 'job_id');
    const oldE = required(fd, 'old_employee_id');
    const newE = required(fd, 'employee_id', 'Replacement cleaner');
    const { data: old } = await supabase.from('job_assignments').select('is_team_lead').eq('job_id', job).eq('employee_id', oldE).single();
    must(await supabase.rpc('assign_employee', { p_job: job, p_employee: newE, p_team_lead: !!old?.is_team_lead, p_force: false }));
    must(await supabase.rpc('unassign_employee', { p_job: job, p_employee: oldE }));
    const { data: j } = await supabase.from('cleaning_jobs').select('status').eq('id', job).single();
    if (j?.status === 'needs_attention') await supabase.from('cleaning_jobs').update({ status: 'assigned' }).eq('id', job);
    return 'Replacement assigned; both cleaners were notified.';
  }, ['/admin']);
}

export async function qualityReview(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const rating = num(fd, 'client_rating');
    must(await supabase.from('cleaning_jobs').update({
      quality_status: required(fd, 'quality_status'),
      quality_notes: str(fd, 'quality_notes'),
      client_feedback: str(fd, 'client_feedback'),
      client_rating: rating,
    }).eq('id', required(fd, 'id')));
    if (fd.get('quality_status') === 'flagged' && str(fd, 'quality_notes')) {
      must(await supabase.rpc('report_issue', {
        p_job: required(fd, 'id'), p_category: 'quality', p_description: str(fd, 'quality_notes'), p_photo_path: null,
      }));
    }
    return 'Quality review saved.';
  }, ['/admin']);
}

export async function flagChecklistItem(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const flagged = fd.get('flagged') !== 'false';
    must(await supabase.from('checklist_submissions').update({ flagged, flag_note: flagged ? str(fd, 'flag_note') ?? 'Flagged in QC' : null })
      .eq('id', required(fd, 'id')));
    return flagged ? 'Task flagged.' : 'Flag cleared.';
  }, ['/admin']);
}

export async function logIssue(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('report_issue', {
      p_job: required(fd, 'job_id'), p_category: required(fd, 'category'),
      p_description: required(fd, 'description', 'Description'), p_photo_path: null,
    }));
    return 'Issue recorded.';
  }, ['/admin']);
}

export async function updateIssue(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const status = required(fd, 'status');
    must(await supabase.from('job_issues').update({
      status, resolution: str(fd, 'resolution'),
      resolved_by: status === 'resolved' ? user?.id : null,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }).eq('id', required(fd, 'id')));
    return 'Issue updated.';
  }, ['/admin']);
}

export async function reviewAttendanceException(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('review_attendance_exception', {
      p_attendance: required(fd, 'id'), p_approve: fd.get('decision') === 'approve', p_note: str(fd, 'note'),
    }));
    return 'Exception reviewed; the cleaner was notified.';
  }, ['/admin']);
}
