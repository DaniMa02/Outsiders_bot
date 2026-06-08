// utils/dateTime.js

/**
 * Determina si una fecha cae en horario de verano (CEST) en Europe/Madrid
 * CEST: último domingo de marzo 01:00 UTC → último domingo de octubre 01:00 UTC
 */
export function isMadridDST(date) {
  const year = date.getUTCFullYear();

  const marchLast = new Date(Date.UTC(year, 2, 31));
  const marchLastSunday = 31 - marchLast.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, marchLastSunday, 1, 0, 0));

  const octLast = new Date(Date.UTC(year, 9, 31));
  const octLastSunday = 31 - octLast.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 9, octLastSunday, 1, 0, 0));

  return date >= dstStart && date < dstEnd;
}

/**
 * Parsear fecha (DD/MM) y hora (HH:MM) a datetime Madrid (convertido a UTC).
 * Si la fecha ya pasó este año, se usa el año siguiente.
 *
 * @param {string} fechaStr - "DD/MM"
 * @param {string} horaStr  - "HH:MM"
 * @returns {{ datetime: Date|null, error: string|null }}
 */
export function parseDateTimeSpain(fechaStr, horaStr) {
  const fechaRegex = /^(\d{1,2})\/(\d{1,2})$/;
  const fechaMatch = fechaStr.match(fechaRegex);

  if (!fechaMatch) {
    return { datetime: null, error: '❌ Formato de fecha incorrecto. Usa: DD/MM' };
  }

  const [_, dia, mes] = fechaMatch.map(Number);

  const horaRegex = /^(\d{1,2}):(\d{2})$/;
  const horaMatch = horaStr.match(horaRegex);

  if (!horaMatch) {
    return { datetime: null, error: '❌ Formato de hora incorrecto. Usa: HH:MM' };
  }

  const [__, hora, minuto] = horaMatch.map(Number);

  if (mes < 1 || mes > 12) {
    return { datetime: null, error: '❌ Mes inválido (1-12)' };
  }
  if (dia < 1 || dia > 31) {
    return { datetime: null, error: '❌ Día inválido (1-31)' };
  }
  if (hora < 0 || hora > 23) {
    return { datetime: null, error: '❌ Hora inválida (0-23)' };
  }
  if (minuto < 0 || minuto > 59) {
    return { datetime: null, error: '❌ Minuto inválido (0-59)' };
  }

  const now = new Date();
  let year = now.getFullYear();

  const tentativeUTC = new Date(Date.UTC(year, mes - 1, dia, hora, minuto, 0));
  const offsetHours = isMadridDST(tentativeUTC) ? 2 : 1;

  let datetime = new Date(Date.UTC(year, mes - 1, dia, hora - offsetHours, minuto, 0));

  if (datetime <= now) {
    const tentativeNext = new Date(Date.UTC(year + 1, mes - 1, dia, hora, minuto, 0));
    const offsetNext = isMadridDST(tentativeNext) ? 2 : 1;
    datetime = new Date(Date.UTC(year + 1, mes - 1, dia, hora - offsetNext, minuto, 0));
  }

  if (isNaN(datetime.getTime())) {
    return { datetime: null, error: '❌ Fecha inválida' };
  }

  return { datetime, error: null };
}

/**
 * Formatea un datetime (UTC) a fecha Madrid "DD/MM"
 */
export function formatFechaMadrid(datetime) {
  return new Date(datetime).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Madrid'
  });
}

/**
 * Formatea un datetime (UTC) a hora Madrid "HH:MM"
 */
export function formatHoraMadrid(datetime) {
  return new Date(datetime).toLocaleString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
    hour12: false
  });
}
