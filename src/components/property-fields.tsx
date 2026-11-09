import { Field, Input, Select, Textarea } from './ui';
import { titleCase } from '@/lib/format';

/** Shared property form fields (create + edit). */
export function PropertyFields({ p = {}, jobTypes, defaultRadius }: { p?: any; jobTypes: string[]; defaultRadius: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Property name"><Input name="name" defaultValue={p.name ?? ''} placeholder="e.g. Main residence" required /></Field>
      <Field label="Cleaning type">
        <Select name="cleaning_type" defaultValue={p.cleaning_type ?? ''}>
          <option value="">—</option>{jobTypes.map((t) => <option key={t}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Full address" className="sm:col-span-2"><Input name="address" defaultValue={p.address ?? ''} required placeholder="Street, city, state, ZIP" /></Field>
      <Field label="Latitude" hint="Leave blank to look up from the address"><Input name="latitude" type="number" step="any" defaultValue={p.latitude ?? ''} /></Field>
      <Field label="Longitude"><Input name="longitude" type="number" step="any" defaultValue={p.longitude ?? ''} /></Field>
      <Field label="Geofence radius (m)" hint={`Blank = company default (${defaultRadius} m)`}><Input name="geofence_radius_m" type="number" min={10} max={5000} defaultValue={p.geofence_radius_m ?? ''} /></Field>
      <Field label="Recurring frequency">
        <Select name="recurring_frequency" defaultValue={p.recurring_frequency ?? 'none'}>
          {['none', 'weekly', 'biweekly', 'monthly'].map((f) => <option key={f} value={f}>{titleCase(f)}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <Field label="Sq ft"><Input name="square_feet" type="number" min={0} defaultValue={p.square_feet ?? ''} /></Field>
        <Field label="Bedrooms"><Input name="bedrooms" type="number" step="0.5" min={0} defaultValue={p.bedrooms ?? ''} /></Field>
        <Field label="Bathrooms"><Input name="bathrooms" type="number" step="0.5" min={0} defaultValue={p.bathrooms ?? ''} /></Field>
      </div>
      <Field label="Assigned team"><Input name="assigned_team" defaultValue={p.assigned_team ?? ''} placeholder="Preferred team" /></Field>
      <Field label="Status">
        <Select name="is_active" defaultValue={String(p.is_active ?? true)}><option value="true">Active</option><option value="false">Inactive</option></Select>
      </Field>
      <Field label="Access instructions (visible to assigned cleaners)" className="sm:col-span-2"><Textarea name="access_instructions" rows={2} defaultValue={p.access_instructions ?? ''} placeholder="Parking, which door, pets…" /></Field>
      <Field label="Special instructions" className="sm:col-span-2"><Textarea name="special_instructions" rows={2} defaultValue={p.special_instructions ?? ''} /></Field>
    </div>
  );
}
