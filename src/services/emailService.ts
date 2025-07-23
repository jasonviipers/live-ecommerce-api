import { config } from "@/config";
import logger from "@/config/logger";
import { OrderData, TrackingInfo } from "@/types";
import { emailTransporter } from "@/utils/email";
import {
	sendOrderConfirmationEmail,
	sendPasswordResetEmail,
	sendShippingConfirmationEmail,
	welcomeTemplate,
} from "@/utils/email/templates";

export class EmailService {
	private static async sendEmail(emailOptions: {
		to: string;
		subject: string;
		html: string;
		text: string;
	}) {
		try {
			await emailTransporter.sendMail({
				from: config.email.from,
				...emailOptions,
			});
			return true;
		} catch (error) {
			logger.error("Error sending email", error);
			return false;
		}
	}

	static async sendWelcomeEmail(
		user: { firstName: string; lastName: string; email: string },
		verificationLink: string,
	) {
		const email = await welcomeTemplate(user, verificationLink);
		return this.sendEmail(email);
	}

	static async sendPasswordResetEmail(
		user: { firstName: string; lastName: string; email: string },
		resetLink: string,
	) {
		const email = await sendPasswordResetEmail(user, resetLink);
		return this.sendEmail(email);
	}

	static async sendShippingConfirmationEmail(
		orderId: string,
		trackingInfo: TrackingInfo,
	): Promise<boolean> {
		try {
			const email = await sendShippingConfirmationEmail(orderId, trackingInfo);
			const result = await this.sendEmail(email);

			if (result) {
				logger.info("Shipping confirmation email sent successfully", {
					orderId,
					trackingNumber: trackingInfo.trackingNumber,
					recipient: trackingInfo.recipientEmail,
				});
			} else {
				logger.error("Failed to send shipping confirmation email", {
					orderId,
					trackingNumber: trackingInfo.trackingNumber,
				});
			}

			return result;
		} catch (error) {
			logger.error("Error in sendShippingConfirmationEmail", {
				orderId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		}
	}

	static async sendDeliveryConfirmationEmail(orderId: string): Promise<void> {
		//TODO: Implementation would send delivery confirmation email
		logger.info("Delivery confirmation email sent", { orderId });
	}

	static async sendPaymentConfirmationEmail(orderId: string): Promise<void> {
		//TODO: Implementation would send payment confirmation email
		logger.info("Payment confirmation email sent", { orderId });
	}

	static async sendOrderConfirmationEmail(
		orderId: string,
		orderData: OrderData,
	): Promise<boolean> {
		try {
			const email = await sendOrderConfirmationEmail(orderId, orderData);
			const result = await this.sendEmail(email);

			if (result) {
				logger.info("Order confirmation email sent successfully", {
					orderId,
					customerEmail: orderData.customerEmail,
					total: orderData.total,
				});
			} else {
				logger.error("Failed to send order confirmation email", {
					orderId,
					customerEmail: orderData.customerEmail,
				});
			}

			return result;
		} catch (error) {
			logger.error("Error in sendOrderConfirmationEmail", {
				orderId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		}
	}
}
export default EmailService;
