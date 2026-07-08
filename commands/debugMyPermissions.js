// commands/debugMyPermissions.js
import { SlashCommandBuilder } from 'discord.js';
import { getBotVariable } from '../utils/botVariables.js';

/**
 * COMANDO: /debug_my_permissions
 *
 * Muestra el estado REAL de las variables de permisos del bot y los
 * roles del usuario que lo invoca. Pensado para diagnosticar rápidamente
 * por qué un check de Admin/LíderGrupo falla.
 *
 * Uso: /debug_my_permissions
 */
export const debugMyPermissions = {
  data: new SlashCommandBuilder()
    .setName('debug_my_permissions')
    .setDescription('Muestra tus roles y los IDs configurados en el bot (debug).'),

  execute: async function(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    const adminRoleId = getBotVariable('ROLE_ADMIN');
    const liderGrupoRoleId = getBotVariable('ROLE_LIDER_GRUPO');

    const hasAdmin = adminRoleId && member.roles.cache.has(adminRoleId);
    const hasLider = liderGrupoRoleId && member.roles.cache.has(liderGrupoRoleId);

    const userRoleLines = member.roles.cache.map(role => {
      const match =
        (adminRoleId && role.id === adminRoleId) ? ' ← ROLE_ADMIN' :
        (liderGrupoRoleId && role.id === liderGrupoRoleId) ? ' ← ROLE_LIDER_GRUPO' : '';
      return `• \`${role.id}\` — ${role.name}${match}`;
    });

    const lines = [
      `**Tus roles (${member.roles.cache.size}):**`,
      userRoleLines.length > 0 ? userRoleLines.join('\n') : '_Sin roles_',
      '',
      `**Variables del bot (cache en memoria):**`,
      `• \`ROLE_ADMIN\` = ${adminRoleId ? `\`${adminRoleId}\`` : '_(no configurado)_'}`,
      `• \`ROLE_LIDER_GRUPO\` = ${liderGrupoRoleId ? `\`${liderGrupoRoleId}\`` : '_(no configurado)_'}`,
      '',
      `**Resultado del check:**`,
      `• ¿Tiene ROLE_ADMIN? ${hasAdmin ? '✅ Sí' : '❌ No'}`,
      `• ¿Tiene ROLE_LIDER_GRUPO? ${hasLider ? '✅ Sí' : '❌ No'}`,
    ];

    if (liderGrupoRoleId && !hasLider) {
      lines.push('', '**Diagnóstico:**', `El bot busca el role ID \`${liderGrupoRoleId}\` en tu lista de roles y no lo encuentra.`);
      lines.push('Posibles causas:');
      lines.push('1. El ID configurado en `bot_variables.ROLE_LIDER_GRUPO` no coincide con el del rol real en Discord (clic derecho sobre el rol → Copiar ID de rol).');
      lines.push('2. Tienes el rol pero su ID cambió (rol recreado). Vuelve a guardarlo con `/delete_variable ROLE_LIDER_GRUPO` + `/add_variable ROLE_LIDER_GRUPO <id>`.');
      lines.push('3. El rol está en otro servidor (el bot usa IDs específicos de cada servidor).');
    }

    if (!liderGrupoRoleId) {
      lines.push('', '**⚠️ `ROLE_LIDER_GRUPO` no está configurado.**');
      lines.push('Usa `/add_variable ROLE_LIDER_GRUPO <id_del_rol>` para guardarlo.');
    }

    await interaction.editReply({ content: lines.join('\n') });
  }
};
