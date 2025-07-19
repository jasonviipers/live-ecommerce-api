import * as nodemailer from "nodemailer";
import { config } from "../config";
import { logger } from "../config/logger";

export const emailTransporter = nodemailer.createTransport({
	host: config.email.smtp.host,
	port: config.email.smtp.port,
	secure: config.email.smtp.secure,
	auth: {
		user: config.email.smtp.auth.user,
		pass: config.email.smtp.auth.pass,
	},
});
