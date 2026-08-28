import type { Person } from './types';

export const RESIDENCE_FIELDS = ['address', 'country', 'state', 'town', 'lga'] as const;

type ResidenceField = typeof RESIDENCE_FIELDS[number];

export function sharesResidence(person: Person, principal: Person) {
  return RESIDENCE_FIELDS.every((field) => person[field].trim() === principal[field].trim());
}

export function withPrincipalResidence(person: Person, principal: Person) {
  return RESIDENCE_FIELDS.reduce(
    (next, field) => ({ ...next, [field]: principal[field] }),
    person,
  );
}

export function syncDependentResidences(previousPrincipal: Person, nextPrincipal: Person, dependents: Person[]) {
  return dependents.map((dependent) => sharesResidence(dependent, previousPrincipal)
    ? withPrincipalResidence(dependent, nextPrincipal)
    : dependent);
}

export function providerContact(person: Person, principal: Person) {
  return {
    mobile: person.mobile.trim() || principal.mobile.trim(),
    email: person.email.trim() || principal.email.trim(),
  };
}

export type { ResidenceField };
