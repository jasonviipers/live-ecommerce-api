import { config } from "@/config";
import logger from "@/config/logger";
import OrderRepository from "@/repositories/order";
import { UserRepository } from "@/repositories/user";
import {
	DeliveryConfirmationData,
	OrderData,
	PaymentConfirmationData,
	TrackingInfo,
} from "@/types";
import { emailTransporter } from "@/utils/email";
import {
	sendDeliveryConfirmationEmail,
	sendOrderConfirmationEmail,
	sendOtpEmail,
	sendPasswordResetTemplate,
	sendPaymentConfirmationEmail,
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

	static async sendOtpEmail(user: {
		firstName: string;
		lastName: string;
		email: string;
		optCode: string;
	}) {
		const email = await sendOtpEmail(user);
		return this.sendEmail(email);
	}

	static async sendWelcomeEmail(
		user: { firstName: string; lastName: string; email: string },
		verificationLink: string,
	) {
		const email = await welcomeTemplate(user, verificationLink);
		return this.sendEmail(email);
	}

	static async sendPasswordResetEmail(user: {
		firstName: string;
		lastName: string;
		email: string;
		optCode: string;
	}) {
		const email = await sendPasswordResetTemplate(user);
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

	static async sendDeliveryConfirmationEmail(
		data: DeliveryConfirmationData,
	): Promise<boolean> {
		try {
			const order = await OrderRepository.findById(data.orderId);
			if (!order) {
				logger.error("Order not found for delivery confirmation email", {
					orderId: data.orderId,
				});
				return false;
			}

			const user = await UserRepository.findById(order.userId);
			if (!user) {
				logger.error("User not found for delivery confirmation email", {
					orderId: data.orderId,
					userId: order.userId,
				});
				return false;
			}

			// Fetch order items
			const orderItems = await OrderRepository.getOrderItems(data.orderId);

			// Parse shipping address
			let shippingAddress;
			try {
				shippingAddress =
					typeof order.shippingAddress === "string"
						? JSON.parse(order.shippingAddress)
						: order.shippingAddress;
			} catch (error) {
				logger.error("Failed to parse shipping address", {
					orderId: data.orderId,
					error,
				});
				return false;
			}

			if (!shippingAddress) {
				logger.error("No shipping address found for delivery confirmation", {
					orderId: data.orderId,
				});
				return false;
			}

			const deliveryData = {
				customerName: `${user.firstName} ${user.lastName}`,
				customerEmail: user.email,
				deliveryDate: order.deliveredAt || new Date(),
				deliveryAddress: {
					street: shippingAddress.street || "",
					city: shippingAddress.city || "",
					state: shippingAddress.state || "",
					zipCode: shippingAddress.zipCode || "",
					country: shippingAddress.country || "",
				},
				orderItems: orderItems.map((item) => ({
					name:
						item.productName +
						(item.variantName ? ` - ${item.variantName}` : ""),
					quantity: item.quantity,
					price: item.price,
				})),
				totalAmount: order.totalAmount,
				trackingNumber: undefined, // This could be enhanced to fetch actual tracking number
				carrier: undefined, // This could be enhanced to fetch actual carrier
				deliveryNotes: undefined, // This could be enhanced to include delivery notes
			};

			const email = sendDeliveryConfirmationEmail({
				orderId: data.orderId,
				deliveryData,
			});
			const result = await this.sendEmail(email);

			if (result) {
				logger.info("Delivery confirmation email sent successfully", {
					orderId: data.orderId,
					customerEmail: user.email,
					deliveryDate: deliveryData.deliveryDate,
				});
			} else {
				logger.error("Failed to send delivery confirmation email", {
					orderId: data.orderId,
					customerEmail: user.email,
				});
			}
			return result;
		} catch (error) {
			logger.error("Error in sendDeliveryConfirmationEmail", {
				orderId: data.orderId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		}
	}

	static async sendPaymentConfirmationEmail(
		data: PaymentConfirmationData,
	): Promise<boolean> {
		try {
			const order = await OrderRepository.findById(data.orderId);
			if (!order) {
				logger.error("Order not found for payment confirmation email", {
					orderId: data.orderId,
				});
				return false;
			}

			// Fetch user details
			const user = await UserRepository.findById(order.userId);
			if (!user) {
				logger.error("User not found for payment confirmation email", {
					orderId: data.orderId,
					userId: order.userId,
				});
				return false;
			}
			const orderItems = await OrderRepository.getOrderItems(data.orderId);
			const paymentData = {
				customerName: `${user.firstName} ${user.lastName}`,
				customerEmail: user.email,
				amount: order.totalAmount,
				currency: order.currency || "USD",
				paymentMethod: {
					type: "Credit Card", // This could be enhanced to fetch actual payment method
					last4: undefined, // This could be enhanced to fetch actual last 4 digits
				},
				transactionId: `TXN-${order.orderNumber}-${Date.now()}`, // Generate or fetch actual transaction ID
				paymentDate: new Date(),
				orderItems: orderItems.map((item) => ({
					name:
						item.productName +
						(item.variantName ? ` - ${item.variantName}` : ""),
					quantity: item.quantity,
					price: item.price,
				})),
			};
			const email = sendPaymentConfirmationEmail({
				orderId: data.orderId,
				paymentData,
			});
			const result = await this.sendEmail(email);

			if (result) {
				logger.info("Payment confirmation email sent successfully", {
					orderId: data.orderId,
					customerEmail: user.email,
					amount: order.totalAmount,
				});
			} else {
				logger.error("Failed to send payment confirmation email", {
					orderId: data.orderId,
					customerEmail: user.email,
				});
			}
			return result;
		} catch (error) {
			logger.error("Error in sendPaymentConfirmationEmail", {
				orderId: data.orderId,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return false;
		}
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
