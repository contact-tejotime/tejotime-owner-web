-- The microsite trust-bar team noun (barbers/doctors/chefs …) per business category.
-- Stored on the master_data category row so it's data-driven, not hardcoded in the frontend.
alter table master_data add column if not exists team_noun text;
update master_data set team_noun = 'barbers' where type = 'business_category' and name = 'Salon & Barber';
update master_data set team_noun = 'doctors' where type = 'business_category' and name = 'Hospital';
update master_data set team_noun = 'chefs'   where type = 'business_category' and name = 'Restaurant';
