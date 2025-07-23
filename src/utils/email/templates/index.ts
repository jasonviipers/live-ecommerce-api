import { OrderData, TrackingInfo } from "@/types";
import { formatDisplayDate } from "@/utils/date";

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

export const sendPasswordResetEmail = (
	user: { firstName: string; lastName: string; email: string },
	resetOTP: string,
) => ({
	to: user.email,
	subject: "Password Reset Request",
	html: `
    <p>Hello ${user.firstName} ${user.lastName},</p>
    <p>We received a request to reset your password. Please use the following OTP to reset your password:</p>
    <p><strong>${resetOTP}</strong></p>
    <p>If you did not request a password reset, please ignore this email.</p>
  `,
	text: `Hello ${user.firstName} ${user.lastName},
We received a request to reset your password. Please use the following OTP to reset your password:
${resetOTP}
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
