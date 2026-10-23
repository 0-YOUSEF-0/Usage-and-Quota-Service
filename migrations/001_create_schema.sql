CREATE TABLE plans (

   id UUID         PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique ID for each plan 

   account_id       UUID,  -- Owner of a custom plan.

   name             TEXT NOT NULL   -- Plan name with condition to make sure it has a fixed length 
   CHECK (CHAR_LENGTH(BTRIM(name)) BETWEEN 1 AND 58), 
    
   description    TEXT,      --description of the plan.
    
    monthly_limit BIGINT NOT NULL   -- Maximum units allowed per month  and it must be > 0
    CHECK (monthly_limit > 0), 
   
    max_units_per_request   BIGINT NOT NULL   -- Max units allowed in one request and it must be > 0 
    CHECK (max_units_per_request > 0),

     is_predefined    BOOLEAN NOT NULL DEFAULT FALSE,     -- tRUE for predefined plans and  fALSE for custom plans.
   

     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- When the plan was created.
   

     updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),-- When the plan was last updated.
    
   

    -- Predefined plans have no owner.
    -- Custom plans must have an owner account.
   CONSTRAINT plans_predefined_has_no_owner
  CHECK (is_predefined = (account_id IS NULL))
);

CREATE UNIQUE INDEX plans_predefined_name_uniq
  ON plans (lower(name))
  WHERE account_id IS NULL;

CREATE UNIQUE INDEX plans_custom_name_uniq
  ON plans (account_id, lower(name))
  WHERE account_id IS NOT NULL;

--  --------------------------------------------------------- --
 CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- the same we used UUID  
  name          text NOT NULL       
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),   -- the length of the name is between 1 and 160 char 
  api_key_hash  text NOT NULL UNIQUE,    -- the service want to know which account made the request (api_key like secret password for its account.)
  plan_id       uuid NOT NULL REFERENCES plans (id),  -- foriegh key 
  created_at    timestamptz NOT NULL DEFAULT now()     -- it shows the time and date this account was created 
 );


ALTER TABLE plans  -- Now that accounts exist plans can point at their owner.
  ADD CONSTRAINT plans_account_fk
  FOREIGN KEY (account_id) REFERENCES accounts (id);
  
-- --------------------------------------------------------- --
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts (id),
  external_id  text NOT NULL
               CHECK (char_length(btrim(external_id)) BETWEEN 1 AND 200),
  name         text,
  plan_id      uuid NOT NULL REFERENCES plans (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_account_external_uniq UNIQUE (account_id, external_id),  --account cannot have two users with the same external ID.
  CONSTRAINT users_id_account_uniq UNIQUE (id, account_id)  -- table( user_usage)  need to reference both the user and the account together.
);
-- ---------------------------------------------------- --
CREATE TABLE account_usage (
  account_id     uuid NOT NULL REFERENCES accounts (id),
  usage_month    date NOT NULL 
  CHECK (EXTRACT(DAY FROM usage_month) = 1),
  units_used    bigint NOT NULL DEFAULT 0 
  CHECK (units_used >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY   (account_id, usage_month)
);
-- -------------------------------------------------- --
CREATE TABLE user_usage (
  user_id        uuid NOT NULL REFERENCES users (id),
  usage_month    date NOT NULL CHECK (EXTRACT(DAY FROM usage_month) = 1),
  units_used     bigint NOT NULL DEFAULT 0 CHECK (units_used >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY   (user_id, usage_month)
);