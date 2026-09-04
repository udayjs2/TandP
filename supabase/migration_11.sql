-- Migration 11 (OPTIONAL) — run this in Supabase SQL Editor on your EXISTING
-- project if you want to overwrite your current business details with the
-- values from your official Pro Forma Invoice letterhead.
--
-- This OVERWRITES whatever is currently in your settings row. If you've
-- already customized these fields differently, skip this — you can also
-- just edit them yourself anytime from the app: Invoices tab -> Business details.

update settings
set
  business_name = 'T AND P TEXTILES',
  address = 'Chinthavaram Ponnavolu Road, Chillakuru Mandal, Nellore District, Andhra Pradesh - 524412',
  phone = '9384000246',
  gstin = '37CENPN0332K1ZA',
  bank_name = 'Canara Bank',
  account_name = 'T AND P TEXTILES',
  account_number = '125009801350',
  ifsc = 'CNRB0013494',
  branch = 'Chinthavaram',
  upi = '9384000246'
where id = 1;
