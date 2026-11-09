-- =====================================================================
-- Migration 5: starter checklist templates (reference data, editable in Settings → Checklists)
-- =====================================================================
do $$
declare
  v_id uuid;
  t record;
begin
  for t in select * from (values
    ('Standard Residential Clean', 'Standard Residential', 'Routine top-to-bottom clean of living areas, kitchen and bathrooms.'),
    ('Deep Clean', 'Deep Clean', 'Detailed clean including baseboards, inside appliances and build-up removal.'),
    ('Move-In Clean', 'Move-In', 'Empty-home sanitising before new occupants arrive.'),
    ('Move-Out Clean', 'Move-Out', 'Empty-home clean to deposit-return standard.'),
    ('Recurring Maintenance Clean', 'Recurring Maintenance', 'Weekly / bi-weekly upkeep visit.'),
    ('Post-Construction Clean', 'Post-Construction', 'Dust and debris removal after renovation work.')
  ) as x(name, ctype, descr)
  loop
    insert into cleaning_checklists (name, cleaning_type, description) values (t.name, t.ctype, t.descr) returning id into v_id;

    insert into checklist_tasks (checklist_id, area, task, sort_order, is_required, requires_photo)
    select v_id, area, task, ord, req, photo from (values
      ('Kitchen', 'Wipe countertops and backsplash', 10, true, false),
      ('Kitchen', 'Clean sink and polish fixtures', 11, true, false),
      ('Kitchen', 'Wipe appliance exteriors', 12, true, false),
      ('Kitchen', 'Mop floor', 13, true, true),
      ('Bathrooms', 'Clean and disinfect toilet', 20, true, false),
      ('Bathrooms', 'Scrub shower / tub', 21, true, true),
      ('Bathrooms', 'Clean mirrors and vanity', 22, true, false),
      ('Bedrooms', 'Dust all reachable surfaces', 30, true, false),
      ('Bedrooms', 'Make beds / change linens if provided', 31, false, false),
      ('Living Areas', 'Dust furniture and décor', 40, true, false),
      ('Living Areas', 'Vacuum carpets and rugs', 41, true, false),
      ('Whole Home', 'Empty all trash bins', 50, true, false),
      ('Whole Home', 'Final walkthrough', 51, true, true)
    ) as base(area, task, ord, req, photo);

    if t.ctype in ('Deep Clean', 'Move-In', 'Move-Out', 'Post-Construction') then
      insert into checklist_tasks (checklist_id, area, task, sort_order, is_required, requires_photo) values
        (v_id, 'Kitchen', 'Clean inside oven', 14, true, true),
        (v_id, 'Kitchen', 'Clean inside refrigerator', 15, true, true),
        (v_id, 'Kitchen', 'Wipe inside cabinets and drawers', 16, t.ctype <> 'Deep Clean', false),
        (v_id, 'Whole Home', 'Wipe baseboards', 52, true, false),
        (v_id, 'Whole Home', 'Clean light switches and door handles', 53, true, false),
        (v_id, 'Whole Home', 'Interior window sills and tracks', 54, true, false);
    end if;
    if t.ctype = 'Post-Construction' then
      insert into checklist_tasks (checklist_id, area, task, sort_order, is_required, requires_photo) values
        (v_id, 'Whole Home', 'Remove construction dust from vents and fixtures', 55, true, true),
        (v_id, 'Whole Home', 'Remove paint / adhesive residue from surfaces', 56, true, false);
    end if;
  end loop;
end $$;
