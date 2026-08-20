export function normalizeNigerianPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  return digits;
}

export function whatsappVerificationUrl(phone: string) {
  const message = encodeURIComponent('Hello, I am confirming your new FUTO HMO Program subscriber application.');
  return `https://wa.me/${normalizeNigerianPhone(phone)}?text=${message}`;
}
