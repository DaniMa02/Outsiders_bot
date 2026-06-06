// config/eventRoleMapping.js

/**
 * MAPEO DE ROLES DISCORD A CAPABILITIES
 * Vincula roles de Discord con capacidades que pueden cumplir en eventos
 */

/**
 * Mapea cada rol de evento a las capabilities de BD que lo pueden cumplir
 * Ejemplo: Para ser "tank" en un evento, el usuario debe tener HTank en BD
 */
export const ROLE_MAPPING = {
  tank: ['HTank'],
  holy: ['HHealer'],
  debuffer: ['HDebuffer'],
  dd: ['HDD'],
  second_lurer: ['HLurer']
};

/**
 * IDs de roles de Discord para mostrar en embeds/validaciones
 * REEMPLAZA con los IDs reales de tu servidor Discord
 */
export const DISCORD_ROLE_IDS = {
  ADMIN: process.env.ROLE_ADMIN || '',
  LIDER_GRUPO: process.env.ROLE_LIDER_GRUPO || '',
  TANK: process.env.ROLE_TANK || '',
  HOLY: process.env.ROLE_HOLY || '',
  DEBUFFER: process.env.ROLE_DEBUFFER || '',
  DD: process.env.ROLE_DD || '',
  SECOND_LURER: process.env.ROLE_SECOND_LURER || ''
};

/**
 * Validar si usuario puede cumplir un rol específico
 * @param {string[]} userCapabilities - Lista de capabilities del usuario desde BD
 * @param {string} roleRequired - Rol que quiere cumplir (ej: 'tank', 'dd')
 * @returns {boolean}
 */
export function canUserFulfillRole(userCapabilities, roleRequired) {
  const rolesAccepted = ROLE_MAPPING[roleRequired];

  if (!rolesAccepted) {
    return false; // Rol no existe en mapeo
  }

  return rolesAccepted.some(role => userCapabilities.includes(role));
}

/**
 * Obtener descripción de requisito de rol para mostrar al usuario
 * @param {string} roleRequired
 * @returns {string}
 */
export function getRoleRequirementText(roleRequired) {
  const rolesAccepted = ROLE_MAPPING[roleRequired];

  if (!rolesAccepted) {
    return `Rol desconocido: ${roleRequired}`;
  }

  // Convertir códigos a nombres legibles (HTank -> Tank, HDD -> DD)
  const roleNames = rolesAccepted.map(code => {
    if (code.includes('Tank')) return 'Tank';
    if (code.includes('Healer')) return 'Holy';
    if (code.includes('Debuffer')) return 'Debuffer';
    if (code.includes('DD')) return 'DD';
    return code;
  });

  return `Requiere: ${[...new Set(roleNames)].join(' o ')}`;
}

/**
 * Obtener emojis por rol para mostrar en embeds
 */
export const ROLE_EMOJIS = {
  tank: '⚔️',
  holy: '💛',
  debuffer: '🛡️',
  dd: '⚡',
  second_lurer: '🎯'
};

/**
 * Obtener nombres legibles de roles
 */
export const ROLE_NAMES = {
  tank: 'Tank',
  holy: 'Holy',
  debuffer: 'Debuffer',
  dd: 'DD',
  second_lurer: 'Second Lurer'
};
