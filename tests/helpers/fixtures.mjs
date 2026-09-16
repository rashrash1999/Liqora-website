export const owner = { uid: 'customer-a', token: { phone_number: '+966500000001' } };
export const other = { uid: 'customer-b', token: { phone_number: '+966500000002' } };
export const admin = { uid: 'admin-a', token: { admin: true } };
export const gate = { uid: 'gate-a', token: { gate: true } };
export const baseOrder = () => ({
  packageId: 'basic',
  ownerName: 'عميل اختبار',
  phone: '+966500000001',
  occasion: 'حفل زفاف',
  honorees: 'مناسبة اختبار',
  eventDate: '2030-10-12',
  eventTime: '20:00',
  venueName: 'قاعة الاختبار',
  city: 'الرياض',
  mapUrl: 'https://maps.google.com/',
  expectedGuests: 2,
  reminderHours: 48,
  maxCompanions: 2,
  childPolicy: '',
  invitationMessage: '',
  theme: 'classic',
  orientation: 'طولية',
  designTone: 'رسمي',
  preferredColors: '',
  customNotes: '',
  addons: [],
  termsAccepted: true,
});
export const guestRows = () => [
  { name: 'ضيف أول', phone: '0500000011', card_type: 'general', max_companions: 2 },
  { name: 'ضيف ثانٍ', phone: '0500000012', card_type: 'general', max_companions: 0 },
];
