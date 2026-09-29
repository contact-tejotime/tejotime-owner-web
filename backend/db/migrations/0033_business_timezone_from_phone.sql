-- =====================================================================
-- TejoTime — 0033_business_timezone_from_phone
--
-- Every store created through the admin panel got `Asia/Kolkata`, because the
-- form never sent a timezone and the API fell back to the env default. For a
-- store outside India that makes the microsite's "Open now · till 6:00 PM"
-- (and the daily token reset, and analytics day buckets) run on IST.
--
-- Backfill only rows that are provably untouched: still on the IST default AND
-- with a non-Indian dial code. A store whose owner deliberately picked another
-- zone is left alone, and Indian stores are already right.
--
-- A +1 number only narrows to a region — a store can hold an out-of-region
-- number (Empire Cutz: Fort Myers, FL with a Wyoming 307) — so check the US
-- stores afterwards and correct any in the admin panel's Timezone dropdown.
-- Mirrors lib/phone-timezone.ts; idempotent (the where clause excludes
-- anything already moved off the default).
-- =====================================================================

update business set timezone = case
  when country_code = '1' then case
    when substr(phone_number, 1, 3) in (
      '205','251','256','334','659','938','479','501','870','217','224','309','312','331','618','630',
      '708','773','779','815','847','872','319','515','563','641','712','316','620','785','913','225',
      '337','504','985','318','218','320','507','612','651','763','952','228','601','662','769','314',
      '417','573','636','660','816','557','402','531','701','405','539','580','918','572','605','615',
      '629','731','901','931','210','214','254','281','325','361','409','430','469','512','682','713',
      '726','737','806','817','830','832','903','936','940','956','972','979','262','414','534','608',
      '715','920','274','850','219','204','431') then 'America/Chicago'
    when substr(phone_number, 1, 3) in (
      '303','719','720','970','983','208','986','406','505','575','385','435','801','307','915','403',
      '587','780','825','368') then 'America/Denver'
    when substr(phone_number, 1, 3) in ('480','520','602','623','928') then 'America/Phoenix'
    when substr(phone_number, 1, 3) in (
      '209','213','279','310','323','341','408','415','424','442','510','530','559','562','619','626',
      '628','650','657','661','669','707','714','747','760','805','818','820','831','840','858','909',
      '916','925','949','951','702','725','775','458','503','541','971','206','253','360','425','509',
      '564','236','250','604','672','778') then 'America/Los_Angeles'
    when substr(phone_number, 1, 3) = '907' then 'America/Anchorage'
    when substr(phone_number, 1, 3) = '808' then 'Pacific/Honolulu'
    when substr(phone_number, 1, 3) in ('787','939') then 'America/Puerto_Rico'
    when substr(phone_number, 1, 3) in ('902','782','506') then 'America/Halifax'
    when substr(phone_number, 1, 3) in ('306','639') then 'America/Regina'
    else 'America/New_York'
  end
  when country_code = '44'  then 'Europe/London'
  when country_code = '353' then 'Europe/Dublin'
  when country_code = '61'  then 'Australia/Sydney'
  when country_code = '64'  then 'Pacific/Auckland'
  when country_code = '65'  then 'Asia/Singapore'
  when country_code = '60'  then 'Asia/Kuala_Lumpur'
  when country_code = '81'  then 'Asia/Tokyo'
  when country_code = '86'  then 'Asia/Shanghai'
  when country_code = '852' then 'Asia/Hong_Kong'
  when country_code = '92'  then 'Asia/Karachi'
  when country_code = '880' then 'Asia/Dhaka'
  when country_code = '94'  then 'Asia/Colombo'
  when country_code = '977' then 'Asia/Kathmandu'
  when country_code = '971' then 'Asia/Dubai'
  when country_code = '968' then 'Asia/Muscat'
  when country_code = '966' then 'Asia/Riyadh'
  when country_code = '965' then 'Asia/Kuwait'
  when country_code = '974' then 'Asia/Qatar'
  when country_code = '973' then 'Asia/Bahrain'
  when country_code = '27'  then 'Africa/Johannesburg'
  when country_code = '234' then 'Africa/Lagos'
  when country_code = '254' then 'Africa/Nairobi'
  when country_code = '49'  then 'Europe/Berlin'
  when country_code = '33'  then 'Europe/Paris'
  when country_code = '39'  then 'Europe/Rome'
  when country_code = '34'  then 'Europe/Madrid'
end
where timezone = 'Asia/Kolkata'
  and country_code is not null
  and country_code <> '91'
  and country_code in ('1','44','353','61','64','65','60','81','86','852','92','880','94','977','971',
                       '968','966','965','974','973','27','234','254','49','33','39','34');
