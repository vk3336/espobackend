const nodemailer = require("nodemailer");

/**
 * Create Gmail transporter
 */
function createTransporter() {
  return nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

/**
 * Send OTP email to user
 */
async function sendOtpEmail(to, firstName, otp, ttlMinutes) {
  const transporter = createTransporter();

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: "Your OTP Code",
    text:
      `Hi${firstName ? " " + firstName : ""},\n\n` +
      `Your OTP is: ${otp}\n` +
      `This code will expire in ${ttlMinutes} minutes.\n\n` +
      `If you didn't request this, please ignore this email.`,
    html:
      `<div style="font-family: Arial, sans-serif; padding: 20px;">` +
      `<h2>Your OTP Code</h2>` +
      `<p>Hi${firstName ? " " + firstName : ""},</p>` +
      `<p>Your OTP is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>` +
      `<p>This code will expire in ${ttlMinutes} minutes.</p>` +
      `<p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>` +
      `</div>`,
  });
}

module.exports = { sendOtpEmail };
