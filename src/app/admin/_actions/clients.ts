'use server';
import { createClient } from '@/lib/supabase/server';
import { run, must, str, num, required, type ActionState } from '@/lib/actions';
import { geocodeAddress } from '@/lib/geocode';

function clientFields(fd: FormData) {
  const email = str(fd, 'email');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Email address looks invalid');
  return {
    name: required(fd, 'name', 'Client name'),
    email, phone: str(fd, 'phone'),
    billing_address: str(fd, 'billing_address'),
    status: str(fd, 'status') ?? 'active',
    notes: str(fd, 'notes'),
  };
}

export async function createClientRecord(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const row = must(await supabase.from('clients').insert({ ...clientFields(fd), created_by: user?.id }).select('id').single());
    return { message: 'Client created.', data: { id: row.id } };
  }, ['/admin/clients']);
}

export async function updateClientRecord(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    must(await supabase.from('clients').update(clientFields(fd)).eq('id', required(fd, 'id')));
    return 'Client updated.';
  }, ['/admin/clients']);
}

async function propertyFields(fd: FormData) {
  const address = required(fd, 'address', 'Address');
  let lat = num(fd, 'latitude');
  let lng = num(fd, 'longitude');
  let note = '';
  if ((lat == null || lng == null) && fd.get('auto_geocode') !== 'off') {
    const g = await geocodeAddress(address);
    if (g) { lat = g.lat; lng = g.lng; note = ' Coordinates found from the address — verify the pin on the map.'; }
    else note = ' Could not locate this address automatically; add coordinates so GPS verification works.';
  }
  return {
    row: {
      name: required(fd, 'name', 'Property name'), address, latitude: lat, longitude: lng,
      geofence_radius_m: num(fd, 'geofence_radius_m'),
      access_instructions: str(fd, 'access_instructions'),
      cleaning_type: str(fd, 'cleaning_type'),
      square_feet: num(fd, 'square_feet'), bedrooms: num(fd, 'bedrooms'), bathrooms: num(fd, 'bathrooms'),
      special_instructions: str(fd, 'special_instructions'), assigned_team: str(fd, 'assigned_team'),
      recurring_frequency: str(fd, 'recurring_frequency') ?? 'none',
      is_active: fd.get('is_active') !== 'false',
    },
    note,
  };
}

export async function createProperty(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { row, note } = await propertyFields(fd);
    const created = must(await supabase.from('properties').insert({ ...row, client_id: required(fd, 'client_id') }).select('id').single());
    return { message: 'Property added.' + note, data: { id: created.id } };
  }, ['/admin/clients']);
}

export async function updateProperty(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { row, note } = await propertyFields(fd);
    must(await supabase.from('properties').update(row).eq('id', required(fd, 'id')));
    return 'Property updated.' + note;
  }, ['/admin/clients']);
}

export async function saveAccessCodes(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    must(await supabase.from('property_access_codes').upsert({
      property_id: required(fd, 'property_id'),
      entry_code: str(fd, 'entry_code'), lockbox_code: str(fd, 'lockbox_code'),
      alarm_code: str(fd, 'alarm_code'), notes: str(fd, 'notes'),
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }));
    return 'Access codes saved (visible to assigned cleaners only around their job time).';
  }, ['/admin/clients']);
}
