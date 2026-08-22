import { formatDistanceToNowStrict, parseISO } from 'date-fns';

export const DEFAULT_TIMEZONE = 'Africa/Lagos';
export const formatDate = (value: string, timeZone = DEFAULT_TIMEZONE) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(parseISO(value));
export const formatDateTime = (value: string, timeZone = DEFAULT_TIMEZONE) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).format(parseISO(value));

export function zonedInputValue(value: string, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(parseISO(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function zonedInputToIso(value: string, timeZone = DEFAULT_TIMEZONE) {
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    instant += target - Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  }
  return new Date(instant).toISOString();
}
export const timeAgo = (value: string) => formatDistanceToNowStrict(parseISO(value), { addSuffix: true });

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function fullName(person: { firstName: string; middleName?: string; surname: string }) {
  return [person.firstName, person.middleName, person.surname].filter(Boolean).join(' ');
}
