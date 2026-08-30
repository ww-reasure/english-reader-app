const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function localDayKey(timestamp = Date.now()) {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) throw new TypeError('需要有效时间');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDayBounds(dayKey) {
  const match = DAY_KEY.exec(String(dayKey || ''));
  if (!match) throw new TypeError('日期必须为 YYYY-MM-DD');
  const [, year, month, day] = match.map(Number);
  const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (startDate.getFullYear() !== year || startDate.getMonth() !== month - 1 || startDate.getDate() !== day) {
    throw new TypeError('日期不存在');
  }
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

export function splitIntervalByLocalDay({ startedAt, endedAt }) {
  let cursor = Number(startedAt);
  const finish = Number(endedAt);
  if (!Number.isFinite(cursor) || !Number.isFinite(finish) || finish <= cursor) return [];
  const slices = [];
  while (cursor < finish) {
    const dayKey = localDayKey(cursor);
    const boundary = Math.min(finish, localDayBounds(dayKey).end);
    slices.push({ dayKey, startedAt: cursor, endedAt: boundary, durationMs: boundary - cursor });
    cursor = boundary;
  }
  return slices;
}

export function isDayRetained(dayKey, { now = Date.now(), days = 30 } = {}) {
  const count = Math.max(1, Math.trunc(Number(days) || 30));
  const today = new Date(localDayBounds(localDayKey(now)).start);
  today.setDate(today.getDate() - (count - 1));
  const candidate = localDayBounds(dayKey).start;
  return candidate >= today.getTime() && candidate < localDayBounds(localDayKey(now)).end;
}
