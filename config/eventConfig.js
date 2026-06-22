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
    notify_role_var: 'HELL_NOTIFY_ROLE_ID',
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
    notify_role_var: 'HARDCORE_NOTIFY_ROLE_ID',
    max_players: 8,
    roles_required: true,
    // Composición por defecto (también se usa como fallback cuando
    // event.composition es NULL en eventos creados antes de la migración)
    max_roles: {
      tank: 1,
      second_lurer: 1,
      holy: 1,
      debuffer: 1,
      dd: 4
    },
    // Composiciones alternativas elegibles al crear un evento Hardcore
    compositions: [
      {
        id: 'A',
        label: '4 DD · 1 Holy · 1 Tank · 1 Lurer · 1 Debuffer',
        max_roles: {
          tank: 1,
          second_lurer: 1,
          holy: 1,
          debuffer: 1,
          dd: 4
        }
      },
      {
        id: 'B',
        label: '5 DD · 1 Holy · 1 Tank · 1 Lurer',
        max_roles: {
          tank: 1,
          second_lurer: 1,
          holy: 1,
          dd: 5
        }
      }
    ],
    button_style: ButtonStyle.Danger,
    color: 0xff0000 // Rojo oscuro
  },

  raid: {
    icon: '👑',
    label: 'Raid',
    channel_var: 'RAID_CHANNEL_ID',
    notify_role_var: 'RAID_NOTIFY_ROLE_ID',
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

/**
 * Resolver el map de cupos por rol para un evento concreto.
 *
 * Si el tipo define `compositions[]` (ej: Hardcore A/B), usa la composición
 * persistida en `event.composition` (SMALLINT 0=A, 1=B). Si no, cae al
 * `max_roles` del tipo (que también sirve como composición por defecto /
 * fallback para eventos antiguos con `composition` NULL).
 *
 * @param {object} event - Evento con al menos { type, composition }
 * @returns {object} Map roleKey -> maxSlots (vacío si el tipo no existe)
 */
export function getMaxRolesForEvent(event) {
  const config = event?.type ? EVENT_CONFIG[event.type] : null;
  if (!config) return {};

  if (Array.isArray(config.compositions) && event?.composition != null) {
    const compositionId = event.composition === 1 ? 'B' : 'A';
    const c = config.compositions.find(c => c.id === compositionId);
    if (c) return c.max_roles;
  }

  return config.max_roles || {};
}

/**
 * Etiqueta legible de la composición de un evento (ej: "A · 4 DD · 1 Holy · …").
 * Devuelve null si el tipo no tiene composiciones alternativas o el evento
 * no tiene una composición persistida.
 */
export function getCompositionLabel(event) {
  const config = event?.type ? EVENT_CONFIG[event.type] : null;
  if (!config || !Array.isArray(config.compositions) || event?.composition == null) return null;
  const compositionId = event.composition === 1 ? 'B' : 'A';
  const c = config.compositions.find(c => c.id === compositionId);
  return c ? `${c.id} · ${c.label}` : null;
}

/**
 * Texto del botón "Cambiar composición" según la composición actual.
 * Devuelve null si el evento no tiene composiciones alternativas.
 */
export function getToggleCompositionLabel(event) {
  const config = event?.type ? EVENT_CONFIG[event.type] : null;
  if (!config || !Array.isArray(config.compositions) || event?.composition == null) return null;
  const currentId = event.composition === 1 ? 'B' : 'A';
  const next = config.compositions.find(c => c.id !== currentId);
  return next ? `🔄 Cambiar a ${next.id}` : null;
}
