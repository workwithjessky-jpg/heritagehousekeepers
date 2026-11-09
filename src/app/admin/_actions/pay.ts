'use server';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/auth';
import { run, must, str, num, required, type ActionState } from '@/lib/actions';
import { zonedToUtc } from '@/lib/format';

// ------------------------------------------------------------------ timesheets
export async function reviewTimesheets(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const ids = fd.getAll('ids').map(String).filter(Boolean);
    if (!ids.length) throw new Error('Select at least one entry');
    const action = required(fd, 'decision');
    const n = must(await supabase.rpc('review_timesheets', { p_ids: ids, p_action: action, p_notes: str(fd, 'notes') })) as number;
    const verb = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'marked under review';
    return `${n} entr${n === 1 ? 'y' : 'ies'} ${verb}.`;
  }, ['/admin/timesheets', '/admin/payroll']);
}

export async function editTimesheet(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { timezone } = await getSettings();
    must(await supabase.rpc('manager_edit_timesheet', {
      p_id: required(fd, 'id'),
      p_clock_in: zonedToUtc(required(fd, 'clock_in', 'Clock-in'), timezone),
      p_clock_out: zonedToUtc(required(fd, 'clock_out', 'Clock-out'), timezone),
      p_break: num(fd, 'break_minutes') ?? 0,
      p_reason: required(fd, 'reason', 'Reason'),
    }));
    return 'Entry updated. The change and reason were logged and the employee was notified.';
  }, ['/admin/timesheets']);
}

export async function reviewCorrection(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('review_correction', { p_id: required(fd, 'id'), p_approve: fd.get('decision') === 'approve', p_notes: str(fd, 'notes') }));
    return 'Correction reviewed.';
  }, ['/admin/timesheets']);
}

// ------------------------------------------------------------------ payroll
export async function openPeriod(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const p = must(await supabase.rpc('ensure_payroll_period', { p_date: required(fd, 'date', 'Date') })) as any;
    return { message: 'Pay period ready.', data: { id: p.id } };
  }, ['/admin/payroll']);
}

export async function generatePayroll(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const n = must(await supabase.rpc('generate_payroll', { p_period: required(fd, 'period_id') })) as number;
    return `Payroll calculated for ${n} employee${n === 1 ? '' : 's'} from approved hours.`;
  }, ['/admin/payroll']);
}

export async function addPayrollAdjustment(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const amount = num(fd, 'amount');
    if (!amount) throw new Error('Enter an amount');
    must(await supabase.rpc('add_payroll_adjustment', {
      p_record: required(fd, 'record_id'), p_kind: required(fd, 'kind'), p_description: required(fd, 'description', 'Description'), p_amount: amount,
    }));
    return 'Adjustment added and payroll recalculated.';
  }, ['/admin/payroll']);
}

export async function approvePayroll(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('approve_payroll', { p_period: required(fd, 'period_id') }));
    return 'Payroll approved. Employees were notified of their estimated gross pay.';
  }, ['/admin/payroll']);
}

export async function markPaid(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.rpc('mark_payroll_paid', { p_period: required(fd, 'period_id') }));
    return 'Payroll marked as paid. Timesheets in this period are now locked.';
  }, ['/admin/payroll', '/admin/timesheets']);
}
