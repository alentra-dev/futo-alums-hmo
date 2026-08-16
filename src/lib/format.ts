import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export const formatDate = (value: string) => format(parseISO(value), 'd MMM yyyy');
export const formatDateTime = (value: string) => format(parseISO(value), 'd MMM yyyy, h:mm a');
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
