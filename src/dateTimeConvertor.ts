/**
 * Converts a UTC date to Arizona time (Phoenix timezone)
 * Arizona doesn't observe daylight saving time, so it's always UTC-7
 * @param utcDate - The UTC date to convert
 * @returns Date object representing the Arizona time as if it were UTC (for database queries)
 */
export function convertUtcToArizonaTime(utcDate: Date): Date {
    // Get the Arizona time string with proper formatting
    const arizonaTimeString = utcDate.toLocaleString("en-US", {
        timeZone: "America/Phoenix",
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // Parse the formatted string (MM/dd/yyyy, HH:mm:ss) and create proper date
    const [datePart, timePart] = arizonaTimeString.split(', ');
    const [month, day, year] = datePart.split('/');
    const [hour, minute, second] = timePart.split(':');
    
    // Create the date as if it were UTC (this gives us the Arizona time as UTC for database queries)
    return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:${second}.000Z`);
}

