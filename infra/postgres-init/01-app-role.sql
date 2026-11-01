-- Runs once, when the local database volume is first created.
-- DB-10: the app connects as ceyliving_app with data access only; table rights come from the migrations.
-- In staging and production the same role is created in the provider's console with a strong password.
CREATE ROLE ceyliving_app LOGIN PASSWORD 'ceyliving_dev_app';
