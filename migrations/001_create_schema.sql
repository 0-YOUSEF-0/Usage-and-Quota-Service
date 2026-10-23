CREATE TABLE plans (

   id UUID         PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique ID for each plan 

   account_id       UUID,  -- Owner of a custom plan.

   name             TEXT NOT NULL      -- Plan name with condition to make sure it has a fixed length 
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