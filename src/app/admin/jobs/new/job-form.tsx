'use client';
import { useMemo, useState } from 'react';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Field, Input, Select, Textarea, Card, CardHeader, CardBody } from '@/components/ui';
import { createJob } from '../../_actions/jobs';

type Prop = { id: string; name: string; address: string; cleaning_type: string | null; special_instructions: string | null; client: { name: string } | null };

export function JobForm({ properties, checklists, cleaners, jobTypes, pricing, defaults }: {
  properties: Prop[];
  checklists: { id: string; name: string; cleaning_type: string }[];
  cleaners: { id: string; full_name: string; team: string | null }[];
  jobTypes: string[];
  pricing: { service: string; price: number }[];
  defaults: { property?: string; date: string; parent?: string; title?: string; type?: string };
}) {
  const [propertyId, setPropertyId] = useState(defaults.property ?? '');
  const [type, setType] = useState(defaults.type ?? jobTypes[0] ?? 'Standard Residential');
  const [rule, setRule] = useState('none');
  const [selected, setSelected] = useState<string[]>([]);
  const prop = properties.find((p) => p.id === propertyId);
  const suggestedChecklist = useMemo(() => checklists.find((c) => c.cleaning_type === type)?.id ?? '', [checklists, type]);
  const suggestedPrice = pricing.find((p) => p.service === type)?.price;
  const groups = useMemo(() => {
    const m = new Map<string, Prop[]>();
    properties.forEach((p) => m.set(p.client?.name ?? 'Other', [...(m.get(p.client?.name ?? 'Other') ?? []), p]));
    return [...m.entries()];
  }, [properties]);

  return (
    <ActionForm action={createJob} redirectTo={(d) => `/admin/jobs/${d.id}`} className="grid gap-6 lg:grid-cols-3">
      {defaults.parent && <input type="hidden" name="parent_job_id" value={defaults.parent} />}
      <Card className="lg:col-span-2">
        <CardHeader title="Appointment" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Client property" className="sm:col-span-2">
            <Select name="property_id" required value={propertyId} onChange={(e) => {
              setPropertyId(e.target.value);
              const p = properties.find((x) => x.id === e.target.value);
              if (p?.cleaning_type && jobTypes.includes(p.cleaning_type)) setType(p.cleaning_type);
            }}>
              <option value="">Select a property…</option>
              {groups.map(([client, list]) => (
                <optgroup key={client} label={client}>
                  {list.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.address}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Cleaning type">
            <Select name="cleaning_type" value={type} onChange={(e) => setType(e.target.value)}>
              {jobTypes.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Title">
            <Input name="title" required key={`${propertyId}-${type}`} defaultValue={defaults.title ?? (prop ? `${prop.client?.name ?? prop.name} — ${type}` : '')} />
          </Field>
          <Field label="Date"><Input name="date" type="date" required defaultValue={defaults.date} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start"><Input name="start_time" type="time" required defaultValue="09:00" /></Field>
            <Field label="End"><Input name="end_time" type="time" required defaultValue="12:00" /></Field>
          </div>
          <Field label="Checklist">
            <Select name="checklist_id" key={suggestedChecklist} defaultValue={suggestedChecklist}>
              <option value="">No checklist</option>
              {checklists.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Price (revenue)" hint={suggestedPrice != null ? `Service price list: ${suggestedPrice}` : 'Used for revenue & profitability reports'}>
            <Input name="price" type="number" min="0" step="0.01" key={type} defaultValue={suggestedPrice ?? ''} />
          </Field>
          <Field label="Instructions for cleaners" className="sm:col-span-2" hint={prop?.special_instructions ? `Property notes: ${prop.special_instructions}` : undefined}>
            <Textarea name="instructions" rows={3} placeholder="e.g. Focus on kitchen; client working from home office." />
          </Field>
          <Field label="Repeat">
            <Select name="recurrence_rule" value={rule} onChange={(e) => setRule(e.target.value)}>
              <option value="none">Does not repeat</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          {rule !== 'none' && <Field label="Number of visits to schedule"><Input name="occurrences" type="number" min={2} max={52} defaultValue={8} /></Field>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Assign cleaners" subtitle="Optional — you can assign later" />
        <CardBody className="space-y-1">
          {cleaners.length === 0 && <p className="text-sm text-stone-500">No active cleaners yet.</p>}
          {cleaners.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-50">
              <span className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="cleaners" value={c.id} className="size-4 accent-sage-700"
                  onChange={(e) => setSelected((s) => e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id))} />
                {c.full_name} {c.team && <span className="text-xs text-stone-400">· {c.team}</span>}
              </span>
              {selected.includes(c.id) && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <input type="radio" name="team_lead" value={c.id} defaultChecked={selected[0] === c.id} className="accent-sage-700" /> Lead
                </span>
              )}
            </label>
          ))}
          <p className="pt-2 text-xs text-stone-500">Overlapping jobs and approved time off are blocked automatically. Travel-time and availability issues are reported after saving.</p>
          <div className="pt-3"><SubmitButton className="w-full" pendingText="Creating…">Create job</SubmitButton></div>
        </CardBody>
      </Card>
    </ActionForm>
  );
}
