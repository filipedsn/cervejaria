-- LEGADO: cria usuarios prod + dev no mesmo container.
-- Preferir create-env-users-prod-only.sql (prod) e create-env-users-dev-container.sql (dev).
-- Ver scripts/db-create-env-users.ps1

DO $$ BEGIN
  CREATE USER cervejaria_prod WITH PASSWORD :'PROD_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER USER cervejaria_prod WITH PASSWORD :'PROD_PASSWORD';
END $$;

DO $$ BEGIN
  CREATE USER cervejaria_dev WITH PASSWORD :'DEV_PASSWORD';
EXCEPTION WHEN duplicate_object THEN
  ALTER USER cervejaria_dev WITH PASSWORD :'DEV_PASSWORD';
END $$;

REVOKE ALL ON DATABASE cervejaria FROM PUBLIC;
REVOKE ALL ON DATABASE cervejaria_dev FROM PUBLIC;

GRANT CONNECT ON DATABASE cervejaria TO cervejaria, cervejaria_prod;
GRANT CONNECT ON DATABASE cervejaria_dev TO cervejaria, cervejaria_dev;

REVOKE CONNECT ON DATABASE cervejaria FROM cervejaria_dev;
REVOKE CONNECT ON DATABASE cervejaria_dev FROM cervejaria_prod;

GRANT USAGE, CREATE ON SCHEMA public TO cervejaria_prod;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO cervejaria_prod;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO cervejaria_prod;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO cervejaria_prod;
GRANT ALL PRIVILEGES ON ALL TYPES IN SCHEMA public TO cervejaria_prod;
ALTER DEFAULT PRIVILEGES FOR ROLE cervejaria IN SCHEMA public GRANT ALL ON TABLES TO cervejaria_prod;
ALTER DEFAULT PRIVILEGES FOR ROLE cervejaria IN SCHEMA public GRANT ALL ON SEQUENCES TO cervejaria_prod;
ALTER DEFAULT PRIVILEGES FOR ROLE cervejaria IN SCHEMA public GRANT ALL ON FUNCTIONS TO cervejaria_prod;
ALTER DEFAULT PRIVILEGES FOR ROLE cervejaria IN SCHEMA public GRANT ALL ON TYPES TO cervejaria_prod;
