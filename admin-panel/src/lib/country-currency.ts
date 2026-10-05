/**
 * The currency a store in a country normally prices in — the admin Create store form's default
 * (client review row 29, 2026-10-05: "Set the default currency from the store country; USD and the
 * dollar symbol for US stores" — the form defaulted to ₹ while defaulting the phone to +1 US).
 *
 * Keyed by ISO 3166 alpha-2 (the phone field's country, `iso2`), valued by ISO 4217. Only codes that
 * exist in lib/currencies.ts are ever returned, so the select always has the option. A country not
 * listed returns null and the form keeps whatever currency it has: a wrong guess is worse than none.
 * Import-free except for the currency list, so `npm run test:country-currency` loads it as plain TS.
 */
import { CURRENCY_BY_CODE } from "./currencies";

const EURO = [
  "AD", "AT", "AX", "BE", "BL", "CY", "DE", "EE", "ES", "FI", "FR", "GF", "GP", "GR", "HR", "IE",
  "IT", "LT", "LU", "LV", "MC", "ME", "MF", "MQ", "MT", "NL", "PM", "PT", "RE", "SI", "SK", "SM",
  "TF", "VA", "YT",
];
const US_DOLLAR = ["US", "AS", "BQ", "EC", "FM", "GU", "IO", "MH", "MP", "PA", "PR", "PW", "SV", "TC", "TL", "UM", "VG", "VI"];

const BY_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, "EUR"])),
  ...Object.fromEntries(US_DOLLAR.map((c) => [c, "USD"])),
  // North America, Caribbean, Latin America
  CA: "CAD", MX: "MXN", GT: "GTQ", HN: "HNL", NI: "NIO", CR: "CRC", BZ: "BZD", JM: "JMD", BS: "BSD",
  BB: "BBD", TT: "TTD", HT: "HTG", DO: "DOP", CU: "CUP", KY: "KYD", BM: "BMD", AW: "AWG", CW: "ANG",
  SX: "ANG", AG: "XCD", AI: "XCD", DM: "XCD", GD: "XCD", KN: "XCD", LC: "XCD", MS: "XCD", VC: "XCD",
  CO: "COP", VE: "VES", GY: "GYD", SR: "SRD", BR: "BRL", AR: "ARS", CL: "CLP", BO: "BOB", PE: "PEN",
  PY: "PYG", UY: "UYU", FK: "FKP",
  // Europe outside the euro
  GB: "GBP", IM: "GBP", JE: "GBP", GG: "GBP", GI: "GIP", CH: "CHF", LI: "CHF", NO: "NOK", SJ: "NOK",
  SE: "SEK", DK: "DKK", FO: "DKK", GL: "DKK", IS: "ISK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON",
  BG: "BGN", RS: "RSD", BA: "BAM", MK: "MKD", AL: "ALL", MD: "MDL", UA: "UAH", BY: "BYN", RU: "RUB",
  TR: "TRY",
  // South Asia, Middle East
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", BT: "BTN", MV: "MVR", AF: "AFN", AE: "AED",
  SA: "SAR", QA: "QAR", KW: "KWD", BH: "BHD", OM: "OMR", JO: "JOD", IL: "ILS", PS: "ILS", LB: "LBP",
  SY: "SYP", IQ: "IQD", IR: "IRR", YE: "YER",
  // Central & East Asia, South-East Asia, Pacific
  KZ: "KZT", UZ: "UZS", KG: "KGS", TJ: "TJS", TM: "TMT", AZ: "AZN", AM: "AMD", GE: "GEL", CN: "CNY",
  HK: "HKD", MO: "MOP", TW: "TWD", JP: "JPY", KR: "KRW", KP: "KPW", MN: "MNT", SG: "SGD", MY: "MYR",
  ID: "IDR", TH: "THB", VN: "VND", PH: "PHP", KH: "KHR", LA: "LAK", MM: "MMK", BN: "BND",
  AU: "AUD", CX: "AUD", CC: "AUD", NF: "AUD", KI: "AUD", NR: "AUD", TV: "AUD", NZ: "NZD", CK: "NZD",
  NU: "NZD", PN: "NZD", TK: "NZD", FJ: "FJD", PG: "PGK", SB: "SBD", VU: "VUV", WS: "WST", TO: "TOP",
  NC: "XPF", PF: "XPF", WF: "XPF",
  // Africa
  EG: "EGP", LY: "LYD", TN: "TND", DZ: "DZD", MA: "MAD", EH: "MAD", SD: "SDG", SS: "SSP", ET: "ETB",
  ER: "ERN", DJ: "DJF", SO: "SOS", KE: "KES", UG: "UGX", TZ: "TZS", RW: "RWF", BI: "BIF", NG: "NGN",
  GH: "GHS", LR: "LRD", GM: "GMD", GN: "GNF", CV: "CVE", ST: "STN", MR: "MRU", AO: "AOA", CD: "CDF",
  ZM: "ZMW", MW: "MWK", MZ: "MZN", MG: "MGA", MU: "MUR", SC: "SCR", KM: "KMF", ZA: "ZAR", NA: "NAD",
  BW: "BWP", LS: "LSL", SZ: "SZL", SH: "SHP",
  BJ: "XOF", BF: "XOF", CI: "XOF", GW: "XOF", ML: "XOF", NE: "XOF", SN: "XOF", TG: "XOF",
  CM: "XAF", CF: "XAF", TD: "XAF", CG: "XAF", GQ: "XAF", GA: "XAF",
};

/** The country's usual currency (ISO 4217), or null when unknown or not in the currency list. */
export function currencyForCountry(iso2: string | null | undefined): string | null {
  const code = BY_COUNTRY[(iso2 ?? "").toUpperCase()];
  return code && CURRENCY_BY_CODE[code] ? code : null;
}
