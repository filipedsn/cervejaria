-- Banco de desenvolvimento (criado automaticamente em instalações novas do Postgres).
SELECT 'CREATE DATABASE cervejaria_dev'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cervejaria_dev')\gexec
