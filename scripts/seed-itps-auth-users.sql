-- =============================================================================
-- Provision auth.users + auth.identities for the 6 seeded itps employees
-- who currently have no login account.
--
-- After running, all six can log in at http://itps.localhost:3001/login
-- using their `@itps.co.id` email + password `Itps#2026`.
--
-- Idempotent: skips employees that already have a `user_id` link.
--
-- Security note: this is dev/demo only. Password `Itps#2026` is
-- deliberately weak-but-nontrivial so the tenant admin can hand it out
-- once and each user can rotate via `/forgot-password`. Never use this
-- pattern in production — production tenants MUST provision via the
-- Invite User flow so each user sets their own password.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  itps_id       UUID;
  new_user_id   UUID;
  emp_record    RECORD;
  default_pw    TEXT := 'Itps#2026';
BEGIN
  SELECT id INTO itps_id FROM public.tenants WHERE slug = 'itps';
  IF itps_id IS NULL THEN
    RAISE EXCEPTION 'Tenant "itps" not found.';
  END IF;

  FOR emp_record IN
    SELECT id, email, full_name, role
    FROM public.employees
    WHERE tenant_id = itps_id AND user_id IS NULL
    ORDER BY role, full_name
  LOOP
    new_user_id := gen_random_uuid();

    -- Skip if an auth user with this email already exists — reuse it
    -- and just link the employee row. Guards against races or repeat
    -- runs after a partial failure.
    SELECT id INTO new_user_id FROM auth.users WHERE email = emp_record.email LIMIT 1;
    IF new_user_id IS NULL THEN
      new_user_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        email_change,
        email_change_token_new,
        recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        new_user_id,
        'authenticated',
        'authenticated',
        emp_record.email,
        crypt(default_pw, gen_salt('bf')),
        now(),
        jsonb_build_object('provider', 'email', 'providers', ARRAY['email']),
        jsonb_build_object(
          'full_name', emp_record.full_name,
          'tenant_slug', 'itps',
          'tenant_id', itps_id::text,
          'role', emp_record.role::text
        ),
        now(),
        now(),
        '',
        '',
        '',
        ''
      );

      -- auth.identities row so `identities_email_provider_id_key` and
      -- Supabase's session-token flow can resolve the provider linkage.
      -- `email` is a generated column derived from `identity_data->>'email'`
      -- in newer GoTrue schemas, so we intentionally omit it from the
      -- column list — trying to pass it triggers
      -- "cannot insert a non-DEFAULT value into column email".
      INSERT INTO auth.identities (
        provider_id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        new_user_id::text,
        new_user_id,
        jsonb_build_object(
          'sub', new_user_id::text,
          'email', emp_record.email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        NULL,
        now(),
        now()
      );

      RAISE NOTICE 'Created auth account for % (%)', emp_record.full_name, emp_record.role;
    ELSE
      RAISE NOTICE 'Reusing existing auth account for %', emp_record.email;
    END IF;

    UPDATE public.employees
    SET user_id = new_user_id
    WHERE id = emp_record.id AND user_id IS NULL;
  END LOOP;
END;
$$;

-- Post-run summary.
SELECT e.full_name, e.role, e.email,
       CASE WHEN e.user_id IS NULL THEN 'NO LOGIN' ELSE 'has login' END AS status
FROM public.employees e
WHERE e.tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
ORDER BY e.role, e.full_name;

COMMIT;
