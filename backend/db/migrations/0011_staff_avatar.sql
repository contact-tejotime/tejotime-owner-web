-- Staff photos: optional avatar image URL per staff member.
-- Shared by the admin store form, owner app staff CRUD, and the public microsite.
alter table staff add column if not exists avatar_url text;
