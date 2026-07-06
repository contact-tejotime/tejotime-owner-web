-- 0006: About-section photo for the microsite ("Photo — the space" placeholder).
-- hero_image_url and logo_url already exist on business (0001_init); this adds the About image.
alter table business add column if not exists about_image_url text;
