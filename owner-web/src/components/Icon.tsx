import type { CSSProperties } from "react";

/** Lucide-style stroke icons (same set as admin-panel / owner app). */
export const ICONS: Record<string, string> = {
  home: '<path d="M3 9.5 12 2l9 7.5"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/>',
  layoutDashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  calendarCheck:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  settings:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  qrCode:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M20 14v.01M14 20v.01M17 17h.01M20 17v4M17 20h4"/>',
  logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M9 6h.01M15 6h.01M9 10h.01M15 10h.01M9 14h.01M15 14h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  /** Legacy add-on keys — aliased to barber solid pack. */
  razor: '<path d="M3 20L11 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/> <path d="M11 12L20 3" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/> <path d="M20 3C21 2 22.5 2.3 22.8 3.5C23 4.4 22.4 5.2 21.5 5.2C21.1 5.2 20.7 5 20.5 4.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/> <circle cx="11" cy="12" r="1.6" fill="#ffffff"/>',
  clipper: '<rect x="7" y="1.5" width="10" height="4" rx="0.8" fill="currentColor" stroke="none"/> <rect x="7.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="9.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="11.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="13.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="15.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <path d="M6.7 5.5H17.3L16.4 16.5C16.3 17.9 15.1 19 13.7 19H10.3C8.9 19 7.7 17.9 7.6 16.5L6.7 5.5Z" fill="currentColor" stroke="none"/> <rect x="9" y="9" width="6" height="4" rx="1" fill="#ffffff"/> <circle cx="12" cy="11" r="1.1" fill="currentColor" stroke="none"/> <path d="M9 22C7.5 22 6.5 20.8 7 19.5L10 20.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
  droplet: '<path d="M6 22C4.3 22 3 20.7 3 19V13C3 11.3 4.3 10 6 10H10C11.7 10 13 11.3 13 13V19C13 20.7 11.7 22 10 22H6Z" fill="currentColor" stroke="none"/> <rect x="7" y="6.5" width="2" height="4" fill="currentColor" stroke="none"/> <rect x="4.5" y="4" width="7" height="3" rx="1" fill="currentColor" stroke="none"/> <rect x="10.5" y="3" width="7" height="2.2" rx="1.1" fill="currentColor" stroke="none"/> <path d="M17.5 2.8C18.7 2.2 19.8 2.7 20 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/> <path d="M12.5 1L14 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/> <path d="M15 0.5L15.8 2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/> <path d="M17.5 1L17.8 3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  paintbrush: '<rect x="3" y="4" width="18" height="3.5" rx="1.2" fill="currentColor" stroke="none"/> <rect x="4" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="6.6" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="9.2" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="11.8" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="14.4" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="17" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="19.6" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/>',
  /** Barber solid pack (from barber-icons-solid-10.zip). */
  scissorsSolid: '<circle cx="6" cy="6" r="3" fill="none" stroke="currentColor" stroke-width="2.3"/> <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" stroke-width="2.3"/> <path d="M8.7 8.7L21.5 2.5L21.5 5.5L10.3 10.8Z" fill="currentColor" stroke="none"/> <path d="M8.7 15.3L21.5 21.5L21.5 18.5L10.3 13.2Z" fill="currentColor" stroke="none"/> <circle cx="9.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  straightRazor: '<path d="M3 20L11 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/> <path d="M11 12L20 3" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/> <path d="M20 3C21 2 22.5 2.3 22.8 3.5C23 4.4 22.4 5.2 21.5 5.2C21.1 5.2 20.7 5 20.5 4.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/> <circle cx="11" cy="12" r="1.6" fill="#ffffff"/>',
  barberPole: '<defs> <clipPath id="poleClip"> <rect x="7" y="4" width="10" height="15" rx="5"/> </clipPath> </defs> <ellipse cx="12" cy="2.6" rx="4" ry="2" fill="currentColor" stroke="none"/> <rect x="7" y="4" width="10" height="15" rx="5" fill="#ffffff" stroke="currentColor" stroke-width="1.3"/> <g clip-path="url(#poleClip)"> <path d="M5 6L15 -2V1L5 9Z" fill="currentColor" stroke="none"/> <path d="M5 11L18 0V3L5 14Z" fill="currentColor" stroke="none"/> <path d="M5 16L18 5V8L5 19Z" fill="currentColor" stroke="none"/> <path d="M8 20L18 11V14L11 20Z" fill="currentColor" stroke="none"/> </g> <rect x="7" y="4" width="10" height="15" rx="5" fill="none" stroke="currentColor" stroke-width="1.3"/> <ellipse cx="12" cy="20.5" rx="4.3" ry="1.8" fill="currentColor" stroke="none"/>',
  comb: '<rect x="3" y="4" width="18" height="3.5" rx="1.2" fill="currentColor" stroke="none"/> <rect x="4" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="6.6" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="9.2" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="11.8" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="14.4" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="17" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/> <rect x="19.6" y="7" width="1.6" height="12" rx="0.6" fill="currentColor" stroke="none"/>',
  clippers: '<rect x="7" y="1.5" width="10" height="4" rx="0.8" fill="currentColor" stroke="none"/> <rect x="7.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="9.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="11.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="13.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <rect x="15.7" y="0" width="1.2" height="2" fill="currentColor" stroke="none"/> <path d="M6.7 5.5H17.3L16.4 16.5C16.3 17.9 15.1 19 13.7 19H10.3C8.9 19 7.7 17.9 7.6 16.5L6.7 5.5Z" fill="currentColor" stroke="none"/> <rect x="9" y="9" width="6" height="4" rx="1" fill="#ffffff"/> <circle cx="12" cy="11" r="1.1" fill="currentColor" stroke="none"/> <path d="M9 22C7.5 22 6.5 20.8 7 19.5L10 20.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>',
  mustache: '<path d="M12 11C11.5 8.5 9.3 7 7 7.3C5.2 7.5 4 8.8 4.2 10.2C3.2 9.6 1.8 10.1 1.3 11.4C0.7 12.9 1.6 14.4 3.3 14.5C6.6 14.7 9.9 12.9 12 10.3C14.1 12.9 17.4 14.7 20.7 14.5C22.4 14.4 23.3 12.9 22.7 11.4C22.2 10.1 20.8 9.6 19.8 10.2C20 8.8 18.8 7.5 17 7.3C14.7 7 12.5 8.5 12 11Z" fill="currentColor" stroke="none"/>',
  hairDryer: '<polygon points="1,6.5 1,13.5 9,12.5 9,7.5" fill="currentColor" stroke="none"/> <rect x="8.5" y="6" width="7.5" height="8" rx="3.5" fill="currentColor" stroke="none"/> <rect x="13" y="12.5" width="4.5" height="10.5" rx="2.2" transform="rotate(18 13 12.5)" fill="currentColor" stroke="none"/> <rect x="17" y="8.5" width="1.4" height="3" fill="#ffffff"/> <rect x="19.3" y="8.5" width="1.4" height="3" fill="#ffffff"/>',
  sprayBottle: '<path d="M6 22C4.3 22 3 20.7 3 19V13C3 11.3 4.3 10 6 10H10C11.7 10 13 11.3 13 13V19C13 20.7 11.7 22 10 22H6Z" fill="currentColor" stroke="none"/> <rect x="7" y="6.5" width="2" height="4" fill="currentColor" stroke="none"/> <rect x="4.5" y="4" width="7" height="3" rx="1" fill="currentColor" stroke="none"/> <rect x="10.5" y="3" width="7" height="2.2" rx="1.1" fill="currentColor" stroke="none"/> <path d="M17.5 2.8C18.7 2.2 19.8 2.7 20 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/> <path d="M12.5 1L14 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/> <path d="M15 0.5L15.8 2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/> <path d="M17.5 1L17.8 3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  bowTie: '<path d="M2 7.5C2 6.5 2.8 5.9 3.7 6.2L10.5 8.6C11 8.8 11.3 9.3 11.3 9.9V14.1C11.3 14.7 11 15.2 10.5 15.4L3.7 17.8C2.8 18.1 2 17.5 2 16.5V7.5Z" fill="currentColor" stroke="none"/> <path d="M22 7.5C22 6.5 21.2 5.9 20.3 6.2L13.5 8.6C13 8.8 12.7 9.3 12.7 9.9V14.1C12.7 14.7 13 15.2 13.5 15.4L20.3 17.8C21.2 18.1 22 17.5 22 16.5V7.5Z" fill="currentColor" stroke="none"/> <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>',
  barberChair: '<path d="M6.5 2.5H15.5C16.1 2.5 16.5 2.9 16.5 3.5V9H5.5V3.5C5.5 2.9 5.9 2.5 6.5 2.5Z" fill="currentColor" stroke="none"/> <rect x="5" y="9" width="12" height="1.8" rx="0.6" fill="currentColor" stroke="none"/> <path d="M5.5 10.8H8V15C8 15.6 7.6 16 7 16H6.3C5.7 16 5.5 15.6 5.5 15V10.8Z" fill="currentColor" stroke="none"/> <rect x="8.3" y="11.5" width="7.7" height="1.6" rx="0.6" fill="currentColor" stroke="none"/> <rect x="10.3" y="16" width="1.8" height="3.5" fill="currentColor" stroke="none"/> <path d="M6 21.2H16C16 19.6 14.4 18.7 12 18.7C9.7 18.7 8.1 19.5 7.7 20.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  stethoscope: '<path d="M6 3V9C6 11.2 7.8 13 10 13C12.2 13 14 11.2 14 9V3"/><path d="M6 3L4.5 3"/><path d="M14 3L15.5 3"/><path d="M10 13V16.5C10 18.4 11.6 20 13.5 20C15.4 20 17 18.4 17 16.5V15"/><circle cx="19" cy="14.5" r="2"/>',
  injection: '<path d="M20 4L18 6"/><path d="M16.5 3.5L18.5 5.5"/><rect x="10.5" y="7.5" width="9" height="4" rx="0.5" transform="rotate(45 10.5 7.5)"/><path d="M13 9L4 18"/><path d="M14.5 10.5L15.8 9.2"/><path d="M12.5 8.5L13.8 7.2"/><path d="M3 19L5.5 20L4 16.5L3 19Z"/>',
  pulse: '<path d="M3 12H7L9 7L12 17L14 12L15.5 15L17 12H21"/>',
  pill: '<rect x="4.5" y="9.5" width="15" height="6.5" rx="3.25" transform="rotate(-35 4.5 9.5)"/><path d="M9.5 8L14 15"/>',
  firstAid: '<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6C9 5 9.8 4.2 10.8 4.2H13.2C14.2 4.2 15 5 15 6V7.5"/><path d="M12 11V16"/><path d="M9.5 13.5H14.5"/>',
  thermometer: '<path d="M11 4.5C11 3.7 11.7 3 12.5 3C13.3 3 14 3.7 14 4.5V14.8C14.9 15.4 15.5 16.4 15.5 17.5C15.5 19.2 14.2 20.5 12.5 20.5C10.8 20.5 9.5 19.2 9.5 17.5C9.5 16.4 10.1 15.4 11 14.8V4.5Z"/><circle cx="12.5" cy="17.5" r="1.5"/><path d="M11 7H9"/><path d="M11 10H9"/>',
  wheelchair: '<circle cx="10" cy="5" r="1.6"/><path d="M10 8V13H15L18 17"/><path d="M8 13H14"/><path d="M10 13L8 19H5"/><circle cx="9" cy="16" r="5"/>',
  bloodDrop: '<path d="M12 3C12 3 6 10.5 6 14.5C6 17.8 8.7 20.5 12 20.5C15.3 20.5 18 17.8 18 14.5C18 10.5 12 3 12 3Z"/><path d="M9 15C9 16.7 10.3 18 12 18"/>',
  xray: '<path d="M6.5 6.5C7.6 6.5 8.5 7.4 8.5 8.5C8.5 9.1 8.2 9.6 7.8 10L16 18.2C16.4 17.8 16.9 17.5 17.5 17.5C18.6 17.5 19.5 18.4 19.5 19.5C19.5 20.6 18.6 21.5 17.5 21.5C16.4 21.5 15.5 20.6 15.5 19.5C15.5 18.9 15.8 18.4 16.2 18L8 9.8C7.6 10.2 7.1 10.5 6.5 10.5C5.4 10.5 4.5 9.6 4.5 8.5C4.5 7.4 5.4 6.5 6.5 6.5Z"/><path d="M17.5 5.5C18.6 5.5 19.5 4.6 19.5 3.5"/><circle cx="17.5" cy="6.5" r="2"/><circle cx="6.5" cy="17.5" r="2"/>',
  dentalTooth: '<path d="M12 4C9.8 4 8.5 5 7.3 5C5.9 5 4.5 6.2 4.5 8.5C4.5 11 5.5 12 5.8 14.5C6.1 17 6.7 20 8 20C9.2 20 9.3 16.5 10.3 15C10.7 14.4 11.3 14 12 14C12.7 14 13.3 14.4 13.7 15C14.7 16.5 14.8 20 16 20C17.3 20 17.9 17 18.2 14.5C18.5 12 19.5 11 19.5 8.5C19.5 6.2 18.1 5 16.7 5C15.5 5 14.2 4 12 4Z"/>',
  forkKnife: '<path d="M6 3V10C6 11.1 6.9 12 8 12C9.1 12 10 11.1 10 10V3"/><path d="M6 3V7"/><path d="M8 3V7"/><path d="M10 3V7"/><path d="M8 12V21"/><path d="M17 3C15.5 3.7 14.5 5.4 14.5 7.5C14.5 9.6 15.5 11 17 11V21"/>',
  burger: '<path d="M4 10C4 6.7 7.6 4 12 4C16.4 4 20 6.7 20 10"/><path d="M3.5 11H20.5"/><path d="M4 14H20"/><path d="M3.5 17H20.5C20.5 18.7 17.5 20 12 20C6.5 20 3.5 18.7 3.5 17Z"/>',
  pizza: '<path d="M12 3L21 19H3L12 3Z"/><path d="M7.5 11H16.5"/><circle cx="12" cy="8" r="0.9"/><circle cx="10.5" cy="14.5" r="0.9"/><circle cx="13.8" cy="15" r="0.9"/>',
  coffee: '<path d="M5 9H16V15C16 17.8 13.8 20 11 20H10C7.2 20 5 17.8 5 15V9Z"/><path d="M16 10.5H17.5C18.9 10.5 20 11.6 20 13C20 14.4 18.9 15.5 17.5 15.5H16"/><path d="M8 6C8 5 9 4.7 9 3.8"/><path d="M12 6C12 5 13 4.7 13 3.8"/>',
  beverage: '<path d="M7 4H17L15.8 19.5C15.7 20.4 14.9 21 14 21H10C9.1 21 8.3 20.4 8.2 19.5L7 4Z"/><path d="M6.5 8H17.5"/><path d="M20 3L18.5 6"/>',
  dessertCake: '<path d="M12 3V6"/><path d="M12 3.5C11.4 3.5 11 3 11 2.5C11 2 11.5 1.5 12 1C12.5 1.5 13 2 13 2.5C13 3 12.6 3.5 12 3.5Z"/><path d="M4 11C4 8.8 5.8 7 8 7H16C18.2 7 20 8.8 20 11V12H4V11Z"/><path d="M4 12V18C4 19.1 4.9 20 6 20H18C19.1 20 20 19.1 20 18V12"/><path d="M4 16C5 15.3 6 16.7 7 16C8 15.3 9 16.7 10 16C11 15.3 12 16.7 13 16C14 15.3 15 16.7 16 16C17 15.3 18 16.7 20 16"/>',
  chefHat: '<path d="M7.5 20V13.7C6 13.1 5 11.6 5 9.9C5 7.7 6.8 5.9 9 5.9C9.3 5.9 9.6 5.9 9.9 6C10.4 4.3 12 3 13.8 3C15.9 3 17.7 4.6 17.9 6.7C19.7 7 21 8.5 21 10.3C21 12.1 19.7 13.6 18 13.9V20"/><path d="M7.5 20H18"/><path d="M7.5 16.5H18"/>',
  takeawayBox: '<path d="M4.5 9L6 5H18L19.5 9"/><path d="M4.5 9H19.5V18C19.5 19.1 18.6 20 17.5 20H6.5C5.4 20 4.5 19.1 4.5 18V9Z"/><path d="M9.5 9V5"/><path d="M14.5 9V5"/><path d="M12 12V16"/><path d="M10 14H14"/>',
  tableReservation: '<rect x="3" y="8" width="18" height="3" rx="1"/><path d="M5 11V20"/><path d="M19 11V20"/><path d="M9 4C9 3 9.7 2.5 10.5 2.5C11.3 2.5 12 3 12 4C12 4.6 11.6 5 11.2 5.4C10.9 5.7 10.5 6 10.5 6.5"/><circle cx="10.5" cy="7.5" r="0.3"/>',
  menuReceipt: '<path d="M6 3H18V19.5L16 21L14 19.5L12 21L10 19.5L8 21L6 19.5V3Z"/><path d="M9 7H15"/><path d="M9 10H15"/><path d="M9 13H12.5"/>',

  creditCard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.6 17.6 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',
  alertTriangle:
    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  externalLink:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  sparkles:
    '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  gripVertical:
    '<circle cx="9" cy="5" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="19" r="1.2"/><circle cx="15" cy="5" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="19" r="1.2"/>',
};

export type IconName = keyof typeof ICONS;

/** Solid/mixed fill icons — paint with explicit fills; do not inherit root stroke. */
const SOLID_ICONS = new Set([
  "scissorsSolid",
  "straightRazor",
  "barberPole",
  "comb",
  "clippers",
  "mustache",
  "hairDryer",
  "sprayBottle",
  "bowTie",
  "barberChair",
  "razor",
  "clipper",
  "droplet",
  "paintbrush",
]);

export function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  color = "currentColor",
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const raw = ICONS[name];
  if (!raw) return null;
  const solid = SOLID_ICONS.has(name);
  let inner = color !== "currentColor" ? raw.replaceAll("currentColor", color) : raw;
  if (solid && inner.includes("poleClip")) {
    inner = inner.replaceAll("poleClip", `poleClip-${name}`);
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={solid ? "none" : color}
      strokeWidth={solid ? undefined : strokeWidth}
      strokeLinecap={solid ? undefined : "round"}
      strokeLinejoin={solid ? undefined : "round"}
      aria-hidden="true"
      className={className}
      style={{ display: "block", flexShrink: 0, color, ...style }}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
