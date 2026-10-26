const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseTimeToMinutes(value) {
  const match = TIME_RE.exec(String(value || ""));
  if (!match) {
    throw new Error(`Hora no válida: ${value}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export function rangeHours(start, end) {
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  if (endMinutes <= startMinutes) {
    throw new Error("La hora de fin debe ser posterior a la de inicio");
  }
  return (endMinutes - startMinutes) / 60;
}

export function hoursToDuration(hours) {
  const totalMinutes = Math.round(Number(hours) * 60);
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
    throw new Error("Las horas deben ser mayores que cero");
  }
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (wholeHours) {
    parts.push(`${wholeHours}H`);
  }
  if (minutes) {
    parts.push(`${minutes}M`);
  }
  return `PT${parts.join("")}`;
}

export function formatHours(hours) {
  const value = Number(hours);
  const formatted = value.toLocaleString("es-ES", {
    maximumFractionDigits: 2
  });
  return `${formatted} h`;
}

export function todayISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function assertDateISO(value) {
  if (!DATE_RE.test(String(value || ""))) {
    throw new Error(`Fecha no válida: ${value}`);
  }
  return value;
}

export function localDateRangeToUTC(dateISO) {
  assertDateISO(dateISO);
  const start = new Date(`${dateISO}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return {
    after: start.toISOString(),
    before: end.toISOString()
  };
}

export function localDateTimeToUTC(dateISO, time) {
  assertDateISO(dateISO);
  parseTimeToMinutes(time);
  return new Date(`${dateISO}T${time}:00`).toISOString();
}

function timeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return parts;
}

export function zonedTimeToUTC(dateISO, time, timeZone) {
  assertDateISO(dateISO);
  const [hours, minutes] = String(time).split(":").map(Number);
  parseTimeToMinutes(time);
  const [year, month, day] = dateISO.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, hours, minutes, 0);

  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = timeZoneParts(new Date(guess), timeZone);
    const actual = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const delta = desired - actual;
    guess += delta;
    if (delta === 0) {
      break;
    }
  }

  return new Date(guess).toISOString();
}

export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}