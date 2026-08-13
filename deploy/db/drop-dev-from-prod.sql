SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'cervejaria_dev' AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS cervejaria_dev;
DROP USER IF EXISTS cervejaria_dev;
