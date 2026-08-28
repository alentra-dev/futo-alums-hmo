import type { Person } from '../lib/types';
import { sharesResidence, withPrincipalResidence } from '../lib/personDetails';

interface PersonFieldsProps {
  person: Person;
  principal?: Person;
  onChange: (person: Person) => void;
}

export function PersonFields({ person, principal, onChange }: PersonFieldsProps) {
  const dependent = person.memberType === 'Dependent';
  const sameResidence = dependent && principal ? sharesResidence(person, principal) : false;
  const field = (key: keyof Person, value: string) => onChange({ ...person, [key]: value });
  const residenceDisabled = Boolean(dependent && principal && sameResidence);

  return <div className="form-grid">
    <label>Surname<input required autoComplete="family-name" value={person.surname} onChange={(event) => field('surname', event.target.value)} /></label>
    <label>First name<input required autoComplete="given-name" value={person.firstName} onChange={(event) => field('firstName', event.target.value)} /></label>
    <label>Middle name (optional)<input value={person.middleName} onChange={(event) => field('middleName', event.target.value)} /></label>
    <label>Date of birth<input required type="date" value={person.dateOfBirth} onChange={(event) => field('dateOfBirth', event.target.value)} /></label>
    <label>Gender<select value={person.gender} onChange={(event) => field('gender', event.target.value)}><option>Female</option><option>Male</option></select></label>
    <label>Relationship<input required value={person.relation} onChange={(event) => field('relation', event.target.value)} /></label>
    <label>Nationality<input required value={person.nationality} onChange={(event) => field('nationality', event.target.value)} /></label>
    <label>Mobile number {dependent && '(optional)'}<input required={!dependent} inputMode="tel" autoComplete={dependent ? 'off' : 'tel'} value={person.mobile} onChange={(event) => field('mobile', event.target.value)} /></label>
    <label className="span-2">Email {dependent && '(optional)'}<input required={!dependent} type="email" autoComplete={dependent ? 'off' : 'email'} value={person.email} onChange={(event) => field('email', event.target.value)} /></label>
    {dependent && principal && <label className="same-residence span-2"><input type="checkbox" checked={sameResidence} onChange={(event) => { if (event.target.checked) onChange(withPrincipalResidence(person, principal)); else field('address', ''); }} /><span>Same residence as principal member</span></label>}
    <label className="span-2">Residential address<textarea required disabled={residenceDisabled} rows={2} value={person.address} onChange={(event) => field('address', event.target.value)} /></label>
    <label>Country<input required disabled={residenceDisabled} value={person.country} onChange={(event) => field('country', event.target.value)} /></label>
    <label>State<input required disabled={residenceDisabled} value={person.state} onChange={(event) => field('state', event.target.value)} /></label>
    <label>Town<input required disabled={residenceDisabled} value={person.town} onChange={(event) => field('town', event.target.value)} /></label>
    <label>LGA<input required disabled={residenceDisabled} value={person.lga} onChange={(event) => field('lga', event.target.value)} /></label>
  </div>;
}
