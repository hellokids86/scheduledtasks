/**
 * Converts a UTC date to Arizona time (Phoenix timezone)
 * Arizona doesn't observe daylight saving time, so it's always UTC-7
 * @param utcDate - The UTC date to convert
 * @returns Date object representing the Arizona time as if it were UTC (for database queries)
 */
export function convertUtcToArizonaTime(utcDate: Date): Date {
    // Use Intl.DateTimeFormat.formatToParts for cross-platform reliability
    // (toLocaleString output format varies between Windows and Linux/Docker)
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Phoenix",
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(utcDate);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    let hour = get('hour');
    const minute = get('minute');
    const second = get('second');

    // Some environments return '24' for midnight; normalize to '00'
    if (hour === '24') hour = '00';

    // Create the date as if it were UTC (this gives us the Arizona time as UTC for database queries)
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
}

