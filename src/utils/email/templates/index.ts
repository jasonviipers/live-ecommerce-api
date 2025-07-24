import {
	DeliveryConfirmationData,
	OrderData,
	PaymentConfirmationData,
	TrackingInfo,
} from "@/types";
import { formatDisplayDate } from "@/utils/date";

export const sendOtpEmailTemplate = (user: {
	firstName: string;
	lastName: string;
	email: string;
	optCode: string;
}) => ({
	to: user.email,
	subject: "OTP Code for Live Ecommerce",
	html: `
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>Your OTP code is: ${user.optCode}</p>
			<p>Please enter this code to complete your registration process.</p>
			<p>Note: This code will expire in 15 minutes.</p>
            <p>If you did not register with Live Ecommerce, please ignore this email.</p>
        `,
	text: `Hello ${user.firstName} ${user.lastName},

Your OTP code is: ${user.optCode}

If you did not register with Live Ecommerce, please ignore this email.

  © ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
`,
});

export const welcomeTemplate = (
	user: { firstName: string; lastName: string; email: string },
	verificationLink: string,
) => ({
	to: user.email,
	subject: "Welcome to Live Ecommerce",
	html: `
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>Thank you for registering with Live Ecommerce. Please verify your email address by clicking on the link below:</p>
            <p><a href="${verificationLink}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">Verify Email</a></p>
            <p>If you cannot click the button above, copy and paste this link into your browser: ${verificationLink}</p>
            <p>If you did not register with Live Ecommerce, please ignore this email.</p>
        `,
	text: `Hello ${user.firstName} ${user.lastName},

Thank you for registering with Live Ecommerce. Please verify your email address by clicking on the link below:

${verificationLink}

If you did not register with Live Ecommerce, please ignore this email.

  © ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
`,
});

export const sendPasswordResetTemplate = (user: {
	firstName: string;
	lastName: string;
	email: string;
	optCode: string;
}) => ({
	to: user.email,
	subject: "Password Reset Request",
	html: `
    <p>Hello ${user.firstName} ${user.lastName},</p>
    <p>We received a request to reset your password. Please use the following OTP to reset your password:</p>
    <p><strong>${user.optCode}</strong></p>
    <p>If you did not request a password reset, please ignore this email.</p>
  `,
	text: `Hello ${user.firstName} ${user.lastName},
We received a request to reset your password. Please use the following OTP to reset your password:
${user.optCode}
If you did not request a password reset, please ignore this email.

`,
});

export const sendShippingConfirmationEmail = (
	orderId: string,
	trackingInfo: TrackingInfo,
) => ({
	to: trackingInfo.recipientEmail,
	subject: `Your Order #${orderId} Has Shipped!`,
	html: `
		<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
			<h2 style="color: #4CAF50; text-align: center;">Your Order Has Shipped!</h2>
			
			<p>Hello ${trackingInfo.recipientName},</p>
			
			<p>Great news! Your order <strong>#${orderId}</strong> has been shipped and is on its way to you.</p>
			
			<div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Shipping Details</h3>
				<p><strong>Tracking Number:</strong> ${trackingInfo.trackingNumber}</p>
				<p><strong>Carrier:</strong> ${trackingInfo.carrier}</p>
				<p><strong>Shipping Date:</strong> ${formatDisplayDate(trackingInfo.shippingDate)}</p>
				${trackingInfo.estimatedDelivery ? `<p><strong>Estimated Delivery:</strong> ${formatDisplayDate(trackingInfo.estimatedDelivery)}</p>` : ""}
			</div>
			
			<div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Shipping Address</h3>
				<p>
					${trackingInfo.shippingAddress.street}<br>
					${trackingInfo.shippingAddress.city}, ${trackingInfo.shippingAddress.state} ${trackingInfo.shippingAddress.zipCode}<br>
					${trackingInfo.shippingAddress.country}
				</p>
			</div>
			
			${
				trackingInfo.orderItems && trackingInfo.orderItems.length > 0
					? `
			<div style="background-color: #fff8dc; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Order Items</h3>
				${trackingInfo.orderItems
					.map(
						(item) => `
					<div style="border-bottom: 1px solid #eee; padding: 10px 0;">
						<p style="margin: 5px 0;"><strong>${item.name}</strong></p>
						<p style="margin: 5px 0; color: #666;">Quantity: ${item.quantity} | Price: $${item.price.toFixed(2)}</p>
					</div>
				`,
					)
					.join("")}
			</div>
			`
					: ""
			}
			
			${
				trackingInfo.trackingUrl
					? `
			<div style="text-align: center; margin: 30px 0;">
				<a href="${trackingInfo.trackingUrl}" 
				   style="display: inline-block; padding: 12px 30px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
					Track Your Package
				</a>
			</div>
			`
					: ""
			}
			
			<p>You can also track your package using the tracking number <strong>${trackingInfo.trackingNumber}</strong> on the ${trackingInfo.carrier} website.</p>
			
			<p>Thank you for shopping with Live Ecommerce!</p>
			
			<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
			<p style="color: #666; font-size: 12px; text-align: center;">
				© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
			</p>
		</div>
	`,
	text: `
Your Order #${orderId} Has Shipped!

Hello ${trackingInfo.recipientName},

Great news! Your order #${orderId} has been shipped and is on its way to you.

Shipping Details:
- Tracking Number: ${trackingInfo.trackingNumber}
- Carrier: ${trackingInfo.carrier}
- Shipping Date: ${formatDisplayDate(trackingInfo.shippingDate)}
${trackingInfo.estimatedDelivery ? `- Estimated Delivery: ${formatDisplayDate(trackingInfo.estimatedDelivery)}` : ""}

Shipping Address:
${trackingInfo.shippingAddress.street}
${trackingInfo.shippingAddress.city}, ${trackingInfo.shippingAddress.state} ${trackingInfo.shippingAddress.zipCode}
${trackingInfo.shippingAddress.country}

${
	trackingInfo.orderItems && trackingInfo.orderItems.length > 0
		? `
Order Items:
${trackingInfo.orderItems.map((item) => `- ${item.name} (Qty: ${item.quantity}, Price: $${item.price.toFixed(2)})`).join("\n")}
`
		: ""
}

You can track your package using the tracking number ${trackingInfo.trackingNumber} on the ${trackingInfo.carrier} website.
${trackingInfo.trackingUrl ? `\nTrack your package: ${trackingInfo.trackingUrl}` : ""}

Thank you for shopping with Live Ecommerce!

© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
	`,
});

export const sendOrderConfirmationEmail = (
	orderId: string,
	orderData: OrderData,
) => ({
	to: orderData.customerEmail,
	subject: `Order Confirmation #${orderId} - Thank You for Your Purchase!`,
	html: `
		<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
			<h2 style="color: #4CAF50; text-align: center;">Order Confirmation</h2>
			
			<p>Hello ${orderData.customerName},</p>
			
			<p>Thank you for your order! We're excited to confirm that we've received your order and it's being processed.</p>
			
			<div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Order Details</h3>
				<p><strong>Order Number:</strong> #${orderId}</p>
				<p><strong>Order Date:</strong> ${formatDisplayDate(orderData.orderDate)}</p>
				${orderData.estimatedDelivery ? `<p><strong>Estimated Delivery:</strong> ${formatDisplayDate(orderData.estimatedDelivery)}</p>` : ""}
			</div>
			
			<div style="background-color: #fff; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin: 0; padding: 15px; background-color: #f8f9fa; border-bottom: 1px solid #ddd; border-radius: 8px 8px 0 0; color: #333;">Order Items</h3>
				<div style="padding: 15px;">
					${orderData.items
						.map(
							(item) => `
						<div style="border-bottom: 1px solid #eee; padding: 15px 0; display: flex; align-items: center;">
							${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; margin-right: 15px;">` : ""}
							<div style="flex: 1;">
								<h4 style="margin: 0 0 5px 0; color: #333;">${item.name}</h4>
								${item.description ? `<p style="margin: 0 0 5px 0; color: #666; font-size: 14px;">${item.description}</p>` : ""}
								<p style="margin: 0; color: #666;">Quantity: ${item.quantity}</p>
							</div>
							<div style="text-align: right;">
								<p style="margin: 0; font-weight: bold; color: #333;">$${(item.price * item.quantity).toFixed(2)}</p>
								<p style="margin: 0; color: #666; font-size: 14px;">$${item.price.toFixed(2)} each</p>
							</div>
						</div>
					`,
						)
						.join("")}
				</div>
			</div>
			
			<div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Order Summary</h3>
				<div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
					<span>Subtotal:</span>
					<span>$${orderData.subtotal.toFixed(2)}</span>
				</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
					<span>Shipping:</span>
					<span>$${orderData.shipping.toFixed(2)}</span>
				</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
					<span>Tax:</span>
					<span>$${orderData.tax.toFixed(2)}</span>
				</div>
				<hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
				<div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 18px;">
					<span>Total:</span>
					<span style="color: #4CAF50;">$${orderData.total.toFixed(2)}</span>
				</div>
			</div>
			
			<div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Shipping Address</h3>
				<p style="margin: 0;">
					${orderData.shippingAddress.street}<br>
					${orderData.shippingAddress.city}, ${orderData.shippingAddress.state} ${orderData.shippingAddress.zipCode}<br>
					${orderData.shippingAddress.country}
				</p>
			</div>
			
			<div style="background-color: #fff8dc; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Payment Method</h3>
				<p style="margin: 0;">
					${orderData.paymentMethod.type}${orderData.paymentMethod.last4 ? ` ending in ${orderData.paymentMethod.last4}` : ""}
				</p>
			</div>
			
			<div style="text-align: center; margin: 30px 0;">
				<p>We'll send you a shipping confirmation email with tracking information once your order ships.</p>
				<p>If you have any questions about your order, please don't hesitate to contact our customer support.</p>
			</div>
			
			<p>Thank you for choosing Live Ecommerce!</p>
			
			<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
			<p style="color: #666; font-size: 12px; text-align: center;">
				© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
			</p>
		</div>
	`,
	text: `
Order Confirmation #${orderId}

Hello ${orderData.customerName},

Thank you for your order! We're excited to confirm that we've received your order and it's being processed.

Order Details:
- Order Number: #${orderId}
- Order Date: ${formatDisplayDate(orderData.orderDate)}
${orderData.estimatedDelivery ? `- Estimated Delivery: ${formatDisplayDate(orderData.estimatedDelivery)}` : ""}

Order Items:
${orderData.items.map((item) => `- ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}`).join("\n")}

Order Summary:
Subtotal: $${orderData.subtotal.toFixed(2)}
Shipping: $${orderData.shipping.toFixed(2)}
Tax: $${orderData.tax.toFixed(2)}
Total: $${orderData.total.toFixed(2)}

Shipping Address:
${orderData.shippingAddress.street}
${orderData.shippingAddress.city}, ${orderData.shippingAddress.state} ${orderData.shippingAddress.zipCode}
${orderData.shippingAddress.country}

Payment Method:
${orderData.paymentMethod.type}${orderData.paymentMethod.last4 ? ` ending in ${orderData.paymentMethod.last4}` : ""}

We'll send you a shipping confirmation email with tracking information once your order ships.

If you have any questions about your order, please don't hesitate to contact our customer support.

Thank you for choosing Live Ecommerce!

© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
	`,
});

export const sendPaymentConfirmationEmail = (
	data: PaymentConfirmationData,
) => ({
	to: data.paymentData.customerEmail,
	subject: `Payment Confirmation for Order #${data.orderId} - Live Ecommerce`,
	html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
			<h2 style="color: #4CAF50; text-align: center;">Payment Confirmed</h2>
			
			<p>Hello ${data.paymentData.customerName},</p>
			
			<p>Great news! We've successfully received your payment for order #${data.orderId}. Your order is now being processed and will be shipped soon.</p>
			
			<div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50;">
				<h3 style="margin-top: 0; color: #2e7d32;">Payment Details</h3>
				<p><strong>Order Number:</strong> #${data.orderId}</p>
				<p><strong>Transaction ID:</strong> ${data.paymentData.transactionId}</p>
				<p><strong>Payment Date:</strong> ${formatDisplayDate(data.paymentData.paymentDate)}</p>
				<p><strong>Amount Paid:</strong> ${data.paymentData.currency.toUpperCase()} $${data.paymentData.amount.toFixed(2)}</p>
				<p><strong>Payment Method:</strong> ${data.paymentData.paymentMethod.type}${data.paymentData.paymentMethod.last4 ? ` ending in ${data.paymentData.paymentMethod.last4}` : ""}</p>
			</div>
			
			<div style="background-color: #fff; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin: 0; padding: 15px; background-color: #f8f9fa; border-bottom: 1px solid #ddd; border-radius: 8px 8px 0 0; color: #333;">Order Items</h3>
				<div style="padding: 15px;">
					${data.paymentData.orderItems
						.map(
							(item) => `
						<div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items: center;">
							<div>
								<h4 style="margin: 0 0 5px 0; color: #333;">${item.name}</h4>
								<p style="margin: 0; color: #666;">Quantity: ${item.quantity}</p>
							</div>
							<div style="text-align: right;">
								<p style="margin: 0; font-weight: bold; color: #333;">$${(item.price * item.quantity).toFixed(2)}</p>
								<p style="margin: 0; color: #666; font-size: 14px;">$${item.price.toFixed(2)} each</p>
							</div>
						</div>
					`,
						)
						.join("")}
				</div>
			</div>
			
			<div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">What's Next?</h3>
				<p style="margin: 5px 0;">✅ Payment confirmed and processed</p>
				<p style="margin: 5px 0;">📦 Your order is being prepared for shipment</p>
				<p style="margin: 5px 0;">🚚 You'll receive a shipping confirmation email with tracking details</p>
			</div>
			
			<div style="text-align: center; margin: 30px 0;">
				<p>Thank you for your trust in Live Ecommerce. If you have any questions about your payment or order, please don't hesitate to contact our customer support.</p>
			</div>
			
			<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
			<p style="color: #666; font-size: 12px; text-align: center;">
				© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.<br>
				This is an automated email. Please do not reply to this message.
			</p>
		</div>
	`,
	text: `
Payment Confirmation for Order #${data.orderId}

Hello ${data.paymentData.customerName},

Great news! We've successfully received your payment for order #${data.orderId}. Your order is now being processed and will be shipped soon.

Payment Details:
- Order Number: #${data.orderId}
- Transaction ID: ${data.paymentData.transactionId}
- Payment Date: ${formatDisplayDate(data.paymentData.paymentDate)}
- Amount Paid: ${data.paymentData.currency.toUpperCase()} $${data.paymentData.amount.toFixed(2)}
- Payment Method: ${data.paymentData.paymentMethod.type}${data.paymentData.paymentMethod.last4 ? ` ending in ${data.paymentData.paymentMethod.last4}` : ""}

Order Items:
${data.paymentData.orderItems.map((item) => `- ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}`).join("\n")}

What's Next?
✅ Payment confirmed and processed
📦 Your order is being prepared for shipment
🚚 You'll receive a shipping confirmation email with tracking details

Thank you for your trust in Live Ecommerce. If you have any questions about your payment or order, please don't hesitate to contact our customer support.

© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
This is an automated email. Please do not reply to this message.
	`,
});

export const sendDeliveryConfirmationEmail = (
	data: DeliveryConfirmationData,
) => ({
	to: data.deliveryData.customerEmail,
	subject: `Order #${data.orderId} Delivered Successfully - Live Ecommerce`,
	html: `
		<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
			<h2 style="color: #4CAF50; text-align: center;">🎉 Order Delivered!</h2>
			
			<p>Hello ${data.deliveryData.customerName},</p>
			
			<p>Excellent news! Your order #${data.orderId} has been successfully delivered. We hope you're delighted with your purchase!</p>
			
			<div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4CAF50;">
				<h3 style="margin-top: 0; color: #2e7d32;">Delivery Details</h3>
				<p><strong>Order Number:</strong> #${data.orderId}</p>
				<p><strong>Delivery Date:</strong> ${formatDisplayDate(data.deliveryData.deliveryDate)}</p>
				${data.deliveryData.trackingNumber ? `<p><strong>Tracking Number:</strong> ${data.deliveryData.trackingNumber}</p>` : ""}
				${data.deliveryData.carrier ? `<p><strong>Carrier:</strong> ${data.deliveryData.carrier}</p>` : ""}
			</div>
			
			<div style="background-color: #f0f8ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">Delivery Address</h3>
				<p style="margin: 0;">
					${data.deliveryData.deliveryAddress.street}<br>
					${data.deliveryData.deliveryAddress.city}, ${data.deliveryData.deliveryAddress.state} ${data.deliveryData.deliveryAddress.zipCode}<br>
					${data.deliveryData.deliveryAddress.country}
				</p>
				${data.deliveryData.deliveryNotes ? `<p style="margin: 10px 0 0 0; font-style: italic; color: #666;"><strong>Delivery Notes:</strong> ${data.deliveryData.deliveryNotes}</p>` : ""}
			</div>
			
			<div style="background-color: #fff; border: 1px solid #ddd; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin: 0; padding: 15px; background-color: #f8f9fa; border-bottom: 1px solid #ddd; border-radius: 8px 8px 0 0; color: #333;">Delivered Items</h3>
				<div style="padding: 15px;">
					${data.deliveryData.orderItems
						.map(
							(item) => `
						<div style="border-bottom: 1px solid #eee; padding: 10px 0; display: flex; justify-content: space-between; align-items: center;">
							<div>
								<h4 style="margin: 0 0 5px 0; color: #333;">${item.name}</h4>
								<p style="margin: 0; color: #666;">Quantity: ${item.quantity}</p>
							</div>
							<div style="text-align: right;">
								<p style="margin: 0; font-weight: bold; color: #333;">$${(item.price * item.quantity).toFixed(2)}</p>
							</div>
						</div>
					`,
						)
						.join("")}
					<div style="border-top: 2px solid #4CAF50; padding: 15px 0 0 0; margin-top: 15px;">
						<div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 18px;">
							<span>Total Order Value:</span>
							<span style="color: #4CAF50;">$${data.deliveryData.totalAmount.toFixed(2)}</span>
						</div>
					</div>
				</div>
			</div>
			
			<div style="background-color: #fff8dc; padding: 20px; border-radius: 8px; margin: 20px 0;">
				<h3 style="margin-top: 0; color: #333;">We'd Love Your Feedback!</h3>
				<p style="margin: 0;">Your experience matters to us. Please take a moment to rate your purchase and share your thoughts with other customers.</p>
				<div style="text-align: center; margin: 15px 0;">
					<a href="#" style="display: inline-block; padding: 12px 30px; background-color: #ff9800; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
						Leave a Review
					</a>
				</div>
			</div>
			
			<div style="text-align: center; margin: 30px 0;">
				<p>Thank you for choosing Live Ecommerce! We appreciate your business and hope to serve you again soon.</p>
				<p>If you have any questions or concerns about your delivery, please don't hesitate to contact our customer support.</p>
			</div>
			
			<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
			<p style="color: #666; font-size: 12px; text-align: center;">
				© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.<br>
				This is an automated email. Please do not reply to this message.
			</p>
		</div>
	`,
	text: `
Order #${data.orderId} Delivered Successfully!

Hello ${data.deliveryData.customerName},

Excellent news! Your order #${data.orderId} has been successfully delivered. We hope you're delighted with your purchase!

Delivery Details:
- Order Number: #${data.orderId}
- Delivery Date: ${formatDisplayDate(data.deliveryData.deliveryDate)}
${data.deliveryData.trackingNumber ? `- Tracking Number: ${data.deliveryData.trackingNumber}` : ""}
${data.deliveryData.carrier ? `- Carrier: ${data.deliveryData.carrier}` : ""}

Delivery Address:
${data.deliveryData.deliveryAddress.street}
${data.deliveryData.deliveryAddress.city}, ${data.deliveryData.deliveryAddress.state} ${data.deliveryData.deliveryAddress.zipCode}
${data.deliveryData.deliveryAddress.country}
${data.deliveryData.deliveryNotes ? `\nDelivery Notes: ${data.deliveryData.deliveryNotes}` : ""}

Delivered Items:
${data.deliveryData.orderItems.map((item) => `- ${item.name} (Qty: ${item.quantity}) - $${(item.price * item.quantity).toFixed(2)}`).join("\n")}

Total Order Value: $${data.deliveryData.totalAmount.toFixed(2)}

We'd Love Your Feedback!
Your experience matters to us. Please take a moment to rate your purchase and share your thoughts with other customers.

Thank you for choosing Live Ecommerce! We appreciate your business and hope to serve you again soon.

If you have any questions or concerns about your delivery, please don't hesitate to contact our customer support.

© ${new Date().getFullYear()} Live Ecommerce. All rights reserved.
This is an automated email. Please do not reply to this message.
	`,
});
