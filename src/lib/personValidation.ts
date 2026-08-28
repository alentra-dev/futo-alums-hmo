import type { Person } from './types';

const REQUIRED_PERSON_FIELDS: Array<[keyof Person, string]> = [
  ['surname', 'surname'],
  ['firstName', 'first name'],
  ['middleName', 'middle name (enter N/A if none)'],
  ['dateOfBirth', 'date of birth'],
  ['relation', 'relationship'],
  ['nationality', 'nationality'],
  ['mobile', 'mobile number'],
  ['email', 'email'],
  ['address', 'residential address'],
  ['country', 'country'],
  ['state', 'state'],
  ['town', 'town'],
  ['lga', 'LGA'],
];

export function incompletePersonMessage(person: Person, label: string) {
  const missing = REQUIRED_PERSON_FIELDS
    .filter(([field]) => !String(person[field] ?? '').trim())
    .map(([, name]) => name);
  if (missing.length) return `${label}: complete ${missing.join(', ')}.`;
  if (!person.email.includes('@')) return `${label}: enter a valid email address.`;
  return null;
}
