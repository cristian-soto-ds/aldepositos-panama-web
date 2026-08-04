-- Un solo expedidor activo por (cliente, nombre normalizado).
-- Idempotente. Si hay duplicados previos, desactiva los extras (conserva el
-- barcode_code lexicográficamente menor = el más antiguo típico).

do $$
declare
  r record;
  keeper uuid;
begin
  for r in
    select client_code, normalized_name
    from public.warehouse_shippers
    where active = true
      and coalesce(trim(normalized_name), '') <> ''
    group by client_code, normalized_name
    having count(*) > 1
  loop
    select id into keeper
    from public.warehouse_shippers
    where active = true
      and client_code = r.client_code
      and normalized_name = r.normalized_name
    order by barcode_code asc, created_at asc nulls last, id asc
    limit 1;

    update public.warehouse_ra_codes
    set
      shipper_id = keeper,
      updated_at = now()
    where shipper_id in (
      select id
      from public.warehouse_shippers
      where active = true
        and client_code = r.client_code
        and normalized_name = r.normalized_name
        and id <> keeper
    );

    update public.warehouse_shippers
    set
      active = false,
      updated_at = now()
    where active = true
      and client_code = r.client_code
      and normalized_name = r.normalized_name
      and id <> keeper;
  end loop;
end $$;

create unique index if not exists warehouse_shippers_client_norm_active_uidx
  on public.warehouse_shippers (client_code, normalized_name)
  where active = true and coalesce(trim(normalized_name), '') <> '';
