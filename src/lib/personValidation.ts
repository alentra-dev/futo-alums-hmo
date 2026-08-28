import type { Person } from './types';

const REQUIRED_PERSON_FIELDS: Array<[keyof Person, string]> = [
  ['surname', 'surname'],
  ['firstName', 'first name'],
  ['dateOfBirth', 'date of birth'],
  ['relation', 'relationship'],
  ['nationality', 'nationality'],
  ['address', 'residential address'],
  ['country', 'country'],
  ['state', 'state'],
  ['town', 'town'],
  ['lga', 'LGA'],
];

function normalizedPhone(value: string) {
  return value.replaceAll(/\D/g, '');
}

export function incompletePersonMessage(person: Person, label: string) {
  const required = person.memberType === 'Member'
    ? [...REQUIRED_PERSON_FIELDS, ['mobile', 'mobile number'], ['email', 'email']] as Array<[keyof Person, string]>
    : REQUIRED_PERSON_FIELDS;
  const missing = required
    .filter(([field]) => !String(person[field] ?? '').trim())
    .map(([, name]) => name);
  if (missing.length) return `${label}: complete ${missing.join(', ')}.`;
  if (person.mobile.trim() && normalizedPhone(person.mobile).length < 10) return `${label}: enter a valid mobile number.`;
  if (person.email.trim() && !person.email.includes('@')) return `${label}: enter a valid email address.`;
  return null;
}
