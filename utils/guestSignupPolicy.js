export const GUEST_ROLE_ID = '1421888103773245440';
export const SCHEDULED_GUEST_RESERVATION_MS = 2 * 60 * 60 * 1000;

export function calculateGuestSignupCutoff(datetime, createdAt, isScheduled) {
  const eventTime = new Date(datetime).getTime();
  const creationTime = new Date(createdAt).getTime();

  if (!Number.isFinite(eventTime) || !Number.isFinite(creationTime)) {
    throw new Error('No se pudo calcular el plazo de reserva de invitados.');
  }

  const reservationWindow = isScheduled
    ? SCHEDULED_GUEST_RESERVATION_MS
    : Math.max(0, eventTime - creationTime) / 4;

  return new Date(eventTime - reservationWindow);
}

export function isGuestSignupRestricted(event, now = Date.now()) {
  if (event?.type !== 'hardcore' || !event.guest_signup_cutoff_at) {
    return false;
  }

  return new Date(event.guest_signup_cutoff_at).getTime() > now;
}

export function memberHasGuestRole(member) {
  return Boolean(member?.roles?.cache?.has(GUEST_ROLE_ID));
}
