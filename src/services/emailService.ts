import { config } from "@/config";
import logger from "@/config/logger";
import { emailTransporter } from "@/utils/email";
import { welcomeTemplate } from "@/utils/email/templates/welcome";

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
		const emailOptions = welcomeTemplate(user, verificationLink);
		return EmailService.sendEmail({
			to: user.email,
			subject: emailOptions.subject,
			html: emailOptions.html,
			text: emailOptions.text,
		});
	}

	static async sendPasswordResetEmail(
		user: { firstName: string; lastName: string; email: string },
		resetLink: string,
	) {
		// TODO: send password reset email
	}

	static async sendShippingConfirmationEmail(
		orderId: string,
		trackingInfo: unknown,
	): Promise<void> {
		//TODO: Implementation would send shipping confirmation email
		logger.info("Shipping confirmation email sent", { orderId, trackingInfo });
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
		orderData: any,
	): Promise<void> {
		//TODO: Implementation would send order confirmation email
		logger.info("Order confirmation email sent", { orderId });
	}
}
export default EmailService;
