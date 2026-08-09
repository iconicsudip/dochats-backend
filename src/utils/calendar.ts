/**
 * Utility functions for generating Universal Calendar Links and ICS files
 */

/**
 * Formats a JavaScript Date object to ISO 8601 UTC string without dashes or colons (e.g. 20260517T143000Z)
 * Required by Google Calendar, Outlook, and iCal specifications.
 */
export function formatCalendarDate(date: Date): string {
    return date.toISOString().replace(/-|:|\.\d+/g, '');
}

import { APP_NAME, APP_NAME_LOWER } from "./brand";

export interface CalendarEventParams {
    id: string;
    title: string;
    description: string;
    location?: string;
    startTime: Date;
    durationMinutes: number;
    meetingUrl?: string;
}

export function generateCalendarLinks(event: CalendarEventParams) {
    const start = new Date(event.startTime);
    const end = new Date(start.getTime() + event.durationMinutes * 60000);

    const startFormatted = formatCalendarDate(start);
    const endFormatted = formatCalendarDate(end);

    const fullDescription = event.meetingUrl 
        ? `${event.description}\n\nMeeting Link: ${event.meetingUrl}`
        : event.description;

    // 1. Google Calendar Template URL
    const googleParams = new URLSearchParams({
        action: 'TEMPLATE',
        text: event.title,
        dates: `${startFormatted}/${endFormatted}`,
        details: fullDescription,
        location: event.location || 'Online Meeting',
    });
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?${googleParams.toString()}`;

    // 2. Outlook Calendar Live URL
    const outlookParams = new URLSearchParams({
        path: '/calendar/action/compose',
        rru: 'addevent',
        subject: event.title,
        startdt: start.toISOString(),
        enddt: end.toISOString(),
        body: fullDescription,
        location: event.location || 'Online Meeting',
    });
    const outlookCalendarUrl = `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams.toString()}`;

    return {
        googleCalendarUrl,
        outlookCalendarUrl
    };
}

export function generateIcsContent(event: CalendarEventParams): string {
    const start = new Date(event.startTime);
    const end = new Date(start.getTime() + event.durationMinutes * 60000);

    const startFormatted = formatCalendarDate(start);
    const endFormatted = formatCalendarDate(end);
    const nowFormatted = formatCalendarDate(new Date());

    const descriptionEscaped = (event.meetingUrl 
        ? `${event.description}\\n\\nMeeting Link: ${event.meetingUrl}`
        : event.description).replace(/\n/g, '\\n');

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${APP_NAME}//SaaS Booking Calendar Engine//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${APP_NAME_LOWER}-booking-${event.id}@${APP_NAME_LOWER}.ai`,
        `DTSTAMP:${nowFormatted}`,
        `DTSTART:${startFormatted}`,
        `DTEND:${endFormatted}`,
        `SUMMARY:${event.title}`,
        `DESCRIPTION:${descriptionEscaped}`,
        `LOCATION:${event.location || 'Online Meeting'}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

export function generateMultiEventIcsFeed(events: CalendarEventParams[]): string {
    const nowFormatted = formatCalendarDate(new Date());
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:-//${APP_NAME}//SaaS Live Multi-Calendar Feed//EN`,
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${APP_NAME} Bookings Feed`,
        'X-WR-TIMEZONE:UTC'
    ];

    for (const event of events) {
        const start = new Date(event.startTime);
        const end = new Date(start.getTime() + event.durationMinutes * 60000);

        const startFormatted = formatCalendarDate(start);
        const endFormatted = formatCalendarDate(end);

        const descriptionEscaped = (event.meetingUrl 
            ? `${event.description}\\n\\nMeeting Link: ${event.meetingUrl}`
            : event.description).replace(/\n/g, '\\n');

        lines.push(
            'BEGIN:VEVENT',
            `UID:${APP_NAME_LOWER}-feed-${event.id}@${APP_NAME_LOWER}.ai`,
            `DTSTAMP:${nowFormatted}`,
            `DTSTART:${startFormatted}`,
            `DTEND:${endFormatted}`,
            `SUMMARY:${event.title}`,
            `DESCRIPTION:${descriptionEscaped}`,
            `LOCATION:${event.location || 'Virtual Meeting'}`,
            'STATUS:CONFIRMED',
            'END:VEVENT'
        );
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
}

export interface ParsedIcsEvent {
    uid: string;
    summary: string;
    description: string;
    location: string;
    startTime: Date;
    durationMinutes: number;
}

export function parseIcsContent(icsString: string): ParsedIcsEvent[] {
    const events: ParsedIcsEvent[] = [];
    const lines = icsString.split(/\r?\n/);
    
    let currentEvent: Partial<ParsedIcsEvent> & { startStr?: string; endStr?: string } | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === 'BEGIN:VEVENT') {
            currentEvent = { summary: 'Imported Event', description: '', location: '', durationMinutes: 60 };
        } else if (line === 'END:VEVENT' && currentEvent) {
            if (currentEvent.startStr) {
                const parseDate = (str: string) => {
                    const clean = str.replace(/[^0-9T]/g, '');
                    if (clean.length >= 15) {
                        const year = clean.substring(0, 4);
                        const month = clean.substring(4, 6);
                        const day = clean.substring(6, 8);
                        const hour = clean.substring(9, 11);
                        const min = clean.substring(11, 13);
                        const sec = clean.substring(13, 15);
                        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
                    }
                    return new Date();
                };

                const startDt = parseDate(currentEvent.startStr);
                const endDt = currentEvent.endStr ? parseDate(currentEvent.endStr) : new Date(startDt.getTime() + 60 * 60000);
                const duration = Math.max(15, Math.round((endDt.getTime() - startDt.getTime()) / 60000));

                events.push({
                    uid: currentEvent.uid || `imported-${Math.random().toString(36).substring(2, 9)}`,
                    summary: currentEvent.summary || 'External Meeting',
                    description: currentEvent.description || 'Imported from external calendar.',
                    location: currentEvent.location || 'External Location',
                    startTime: startDt,
                    durationMinutes: duration
                });
            }
            currentEvent = null;
        } else if (currentEvent) {
            if (line.startsWith('UID:')) currentEvent.uid = line.substring(4);
            else if (line.startsWith('SUMMARY:')) currentEvent.summary = line.substring(8);
            else if (line.startsWith('DESCRIPTION:')) currentEvent.description = line.substring(12).replace(/\\n/g, '\n');
            else if (line.startsWith('LOCATION:')) currentEvent.location = line.substring(9);
            else if (line.startsWith('DTSTART')) {
                const parts = line.split(':');
                if (parts.length > 1) currentEvent.startStr = parts[1];
            } else if (line.startsWith('DTEND')) {
                const parts = line.split(':');
                if (parts.length > 1) currentEvent.endStr = parts[1];
            }
        }
    }

    return events;
}
