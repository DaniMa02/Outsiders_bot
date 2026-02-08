// utils/classInference.js
import { classRoleIds } from '../config/classRoles.js'; // mapa que ya tienes de clase -> roleId

export const inferClassFromDiscordRoles = (member) => {
  for (const [className, roleId] of Object.entries(classRoleIds)) {
    if (member.roles.cache.has(roleId)) {
      return className;
    }
  }
  return null;
};
