-- i started the file with 002 to make it organize with the other files 
INSERT INTO plans
  (id, name, description, monthly_limit, max_units_per_request, is_predefined)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Starter',
   'Entry-level plan, intended for accounts', 10000, 100, true),
  ('00000000-0000-0000-0000-000000000002', 'Pro',
   'Larger plan, intended for accounts', 100000, 1000, true),
  ('00000000-0000-0000-0000-000000000003', 'Basic',
   'Standard plan, intended for users', 500, 20, true),
  ('00000000-0000-0000-0000-000000000004', 'Premium',
   'Higher plan, intended for users', 5000, 200, true)
ON CONFLICT (id) DO NOTHING;  -- if a row with this ID already exists, skip it