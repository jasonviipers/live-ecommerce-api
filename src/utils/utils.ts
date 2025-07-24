export const generateOtp = (length: string = "6") => {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	const randomString = Array.from(
		{ length: Number(length) },
		() => charset[Math.floor(Math.random() * charset.length)],
	).join("");
	return randomString;
};

// Helper function to generate tracking URLs for common carriers
export function getTrackingUrl(
	carrier: string,
	trackingNumber: string,
): string | null {
	if (!trackingNumber) return null;

	const normalizedCarrier = carrier.toLowerCase();

	const carrierUrls: Record<string, string> = {
		fedex: `https://www.fedex.com/fedextrack/?tracknumbers=${trackingNumber}`,
		ups: `https://www.ups.com/track?tracknum=${trackingNumber}`,
		usps: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
		dhl: `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`,
		amazon: `https://www.amazon.com/progress-tracker/package/ref=pe_385040_30332190_TE_3p_dp_1/?trackingId=${trackingNumber}`,
	};

	return carrierUrls[normalizedCarrier] || null;
}
