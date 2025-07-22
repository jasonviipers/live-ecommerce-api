export const welcomeTemplate = (
	user: { firstName: string; lastName: string; email: string },
	verificationLink: string,
) => ({
	to: user.email,
	subject: "Welcome to Live Ecommerce",
	body: `
            <p>Hello ${user.firstName} ${user.lastName},</p>
            <p>Thank you for registering with Live Ecommerce. Please verify your email address by clicking on the link below:</p>
            <p>${verificationLink}</p>
            <p>If you did not register with Live Ecommerce, please ignore this email.</p>
        `,
});
