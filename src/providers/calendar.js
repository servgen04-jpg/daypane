
import ICAL from 'ical.js';

const TIMEZONE = 'Europe/Rome';
const MAX_OCCURRENCES = 10000;

function dateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function formatTime(date) {
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

export async function getCalendar() {
  const url = process.env.GOOGLE_CALENDAR_ICS_URL;

  if (!url) {
    return { ok: false, error: 'Calendar URL not configured', items: [] };
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Calendar HTTP ${response.status}`);
    }

    const ics = await response.text();
    const parsed = ICAL.parse(ics);
    const calendar = new ICAL.Component(parsed);

    const now = new Date();

    const components = calendar.getAllSubcomponents('vevent');
    const events = components.map((component) => new ICAL.Event(component));

    const masters = new Map();

    for (const event of events) {
      if (!event.isRecurrenceException() && event.uid) {
        masters.set(event.uid, event);
      }
    }

    for (const event of events) {
      if (event.isRecurrenceException()) {
        const master = masters.get(event.uid);
        if (master) master.relateException(event);
      }
    }

    const items = [];

    for (const event of masters.values()) {
      const iterator = event.iterator();
      let occurrence;
      let count = 0;

      while ((occurrence = iterator.next()) && count < MAX_OCCURRENCES) {
        count++;

        const details = event.getOccurrenceDetails(occurrence);
        const startDate = details.startDate;
        const endDate = details.endDate;

        const start = startDate.toJSDate();
        const end = endDate.toJSDate();
        const day = dateKey(start);

        if (start < now) continue;

        const actualEvent = details.item || event;

        items.push({
          date: day,
          title: actualEvent.summary || 'Senza titolo',
          start: startDate.isDate ? '' : formatTime(start),
          end: startDate.isDate ? '' : formatTime(end),
          allDay: startDate.isDate
        });
      }
    }

    items.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      a.start.localeCompare(b.start) ||
      a.title.localeCompare(b.title)
    );
    items.splice(4);

    return {
      ok: true,
      items,
      fetchedAt: Date.now()
    };
  } catch (error) {
    return {
      ok: false,
      error: `calendar: ${error.message}`,
      items: []
    };
  }
}
