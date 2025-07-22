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

If you did not register with Live Ecommerce, please ignore this email.`,
});
