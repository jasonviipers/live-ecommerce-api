import { config } from "@/config";
import { randomInt } from "node:crypto";
import Stripe from "stripe";

export const generateOtp = (length: number = 6) => {
	if (!Number.isInteger(length) || length < 4 || length > 12) {
		throw new Error("Length must be an integer between 4 and 12");
	}
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	return Array.from({ length }, () => charset[randomInt(charset.length)]).join(
		"",
	);
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

export const stripe = new Stripe(config.stripe.secretKey, {
	apiVersion: "2025-06-30.basil",
});
