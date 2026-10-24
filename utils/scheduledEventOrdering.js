const getClockMinutes = (value) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number.MAX_SAFE_INTEGER;
};

export function groupScheduledEventTemplates(templates) {
  const templateGroups = new Map();

  for (const template of templates) {
    if (!template.active || !template.send_time) continue;

    const normalizedDays = (template.days_of_week || '0,1,2,3,4,5,6')
      .split(',')
      .map(day => day.trim())
      .filter(Boolean)
      .sort((a, b) => Number(a) - Number(b))
      .join(',');
    const groupKey = `${template.send_time}|${normalizedDays}`;
    if (!templateGroups.has(groupKey)) {
      templateGroups.set(groupKey, []);
    }
    templateGroups.get(groupKey).push(template);
  }

  return Array.from(templateGroups.values(), group =>
    group.sort((a, b) =>
      getClockMinutes(a.event_time || '22:00') - getClockMinutes(b.event_time || '22:00')
      || new Date(a.created_at) - new Date(b.created_at)
    )
  );
}
