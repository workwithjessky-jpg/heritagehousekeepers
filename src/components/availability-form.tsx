import { ActionForm, SubmitButton } from './forms';
import { Field, Input } from './ui';
import { addAvailability } from '@/app/admin/_actions/people';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AvailabilityForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={addAvailability} resetOnSuccess className="space-y-3 rounded-xl border border-stone-200 p-3">
      <input type="hidden" name="user_id" value={userId} />
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-sm has-[:checked]:border-sage-500 has-[:checked]:bg-sage-50">
            <input type="checkbox" name="weekday" value={i} className="accent-sage-700" />{d}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="From"><Input type="time" name="start_time" defaultValue="08:00" required /></Field>
        <Field label="To"><Input type="time" name="end_time" defaultValue="17:00" required /></Field>
      </div>
      <Input name="notes" placeholder="Notes (optional)" />
      <SubmitButton variant="secondary">Add availability</SubmitButton>
    </ActionForm>
  );
}

