/**
 * Date formatting utilities with validation and consistent locale handling
 */

export interface DateFormatOptions {
	locale?: string;
	year?: "numeric" | "2-digit";
	month?: "numeric" | "2-digit" | "long" | "short" | "narrow";
	day?: "numeric" | "2-digit";
	weekday?: "long" | "short" | "narrow";
	timeZone?: string;
}

/**
 * Safely formats a date with validation and consistent locale handling
 * @param dateInput - Date string, Date object, or number timestamp
 * @param options - Formatting options for Intl.DateTimeFormat
 * @param locale - Locale string (defaults to 'en-US')
 * @returns Formatted date string or fallback message for invalid dates
 */
export function formatDate(
	dateInput: string | Date | number,
	options: DateFormatOptions = {},
	locale: string = "en-US",
): string {
	try {
		// Convert input to Date object
		const date = new Date(dateInput);

		// Validate the date using isNaN(date.getTime())
		if (isNaN(date.getTime())) {
			console.warn("Invalid date provided to formatDate:", dateInput);
			return "Invalid Date";
		}

		// Default formatting options
		const defaultOptions: DateFormatOptions = {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			...options,
		};

		// Use Intl.DateTimeFormat for consistent, locale-aware formatting
		const formatter = new Intl.DateTimeFormat(locale, defaultOptions);
		return formatter.format(date);
	} catch (error) {
		console.error("Error formatting date:", error);
		return "Invalid Date";
	}
}

/**
 * Formats a date for display in email templates and user interfaces
 * Uses a consistent format across the application
 * @param dateInput - Date string, Date object, or number timestamp
 * @param locale - Locale string (defaults to 'en-US')
 * @returns Formatted date string (e.g., "12/25/2023")
 */
export function formatDisplayDate(
	dateInput: string | Date | number,
	locale: string = "en-US",
): string {
	return formatDate(
		dateInput,
		{
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		},
		locale,
	);
}

/**
 * Formats a date with long month names for more readable display
 * @param dateInput - Date string, Date object, or number timestamp
 * @param locale - Locale string (defaults to 'en-US')
 * @returns Formatted date string (e.g., "December 25, 2023")
 */
export function formatLongDate(
	dateInput: string | Date | number,
	locale: string = "en-US",
): string {
	return formatDate(
		dateInput,
		{
			year: "numeric",
			month: "long",
			day: "numeric",
		},
		locale,
	);
}

/**
 * Validates if a date input is valid
 * @param dateInput - Date string, Date object, or number timestamp
 * @returns true if the date is valid, false otherwise
 */
export function isValidDate(dateInput: string | Date | number): boolean {
	try {
		const date = new Date(dateInput);
		return !isNaN(date.getTime());
	} catch {
		return false;
	}
}
