// config/eventConfig.js
import { ButtonStyle } from 'discord.js';

/**
 * CONFIGURACIÓN CENTRALIZADA DE EVENTOS
 * Fuente de verdad para todos los tipos de contenido
 * Fácil de extender: solo agregar entrada nueva para "mythic", "dungeon", etc
 */

export const EVENT_CONFIG = {
  hell: {
    icon: '🔥',
    label: 'Hell',
    channel_var: 'HELL_CHANNEL_ID',
    max_players: 5,
    roles_required: true,
    max_roles: {
      tank: 1,
      holy: 1,
      debuffer: 1,
      dd: 2
    },
    button_style: ButtonStyle.Success,
    color: 0xff4d4d // Rojo
  },

  hardcore: {
    icon: '⚔️',
    label: 'Hardcore',
    channel_var: 'HARDCORE_CHANNEL_ID',
    max_players: 8,
    roles_required: true,
    max_roles: {
      tank: 1,
      second_lurer: 1,
      holy: 1,
      debuffer: 1,
      dd: 4
    },
    button_style: ButtonStyle.Danger,
    color: 0xff0000 // Rojo oscuro
  },

  raid: {
    icon: '👑',
    label: 'Raid',
    channel_var: 'RAID_CHANNEL_ID',
    max_players: null, // ilimitado
    roles_required: false,
    max_roles: {},
    button_style: ButtonStyle.Primary,
    color: 0x0099ff // Azul
  }
};

/**
 * Estados de participante
 */
export const PARTICIPANT_STATES = {
  ACTIVE: 'ACTIVE',    // Participante confirmado
  RESERVE: 'RESERVE',  // En lista de espera
  ABSENCE: 'ABSENCE'   // Marcado como ausente
};

/**
 * Estados de evento
 */
export const EVENT_STATES = {
  OPEN: 'OPEN',         // Abierto para apuntarse
  FINISHED: 'FINISHED'  // Terminado, no se puede apuntar
};

/**
 * Delay para eliminar embed después de FINISHED (1 hora)
 */
export const EMBED_DELETE_DELAY_MS = 3600000; // 60 * 60 * 1000

/**
 * Validar si un tipo de evento existe
 */
export function isValidEventType(type) {
  return type in EVENT_CONFIG;
}

/**
 * Obtener config de un tipo de evento
 */
export function getEventConfig(type) {
  return EVENT_CONFIG[type];
}
