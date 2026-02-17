const nodemailer = require("nodemailer");
const axios = require("axios");

// Cache for company information (refreshed every 24 hours)
let companyInfoCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch company information from API
 */
async function fetchCompanyInfo() {
  try {
    // Check if cache is valid
    if (
      companyInfoCache &&
      cacheTimestamp &&
      Date.now() - cacheTimestamp < CACHE_TTL
    ) {
      return companyInfoCache;
    }

    const response = await axios.get(process.env.BACKEND_COMPANY_INFORMATION, {
      timeout: 5000,
    });

    if (response.data && response.data.success && response.data.data) {
      // Find the AGE company record
      const ageCompany = response.data.data.find(
        (company) => company.name === "AGE",
      );

      if (ageCompany) {
        companyInfoCache = ageCompany;
        cacheTimestamp = Date.now();
        return ageCompany;
      }
    }

    // Return null if AGE company not found
    return null;
  } catch (error) {
    console.error("Error fetching company information:", error.message);
    // Return cached data if available, even if expired
    return companyInfoCache;
  }
}

/**
 * Get fallback company data (used if API fails)
 */
function getFallbackCompanyData() {
  return {
    legalName: "Amrita Global Enterprises",
    name: "AGE",
    phone1: "+91-9925155141",
    phone2: "+91-9824003484",
    phone1Dept: "Sales",
    phone2Dept: "Director",
    salesEmail: "sales@amrita-fashions.com",
    supportEmail: "support@amrita-fashions.com",
    addressStreet: "404, 4th Floor, Safal Prelude, Opp SPIPA",
    addressCity: "Ahmedabad",
    addressState: "Gujarat",
    addressCountry: "India",
    addressPostalCode: "380015",
    facebookUrl: "https://www.facebook.com/amritaglobal",
    instagramUrl: "https://www.instagram.com/amritaglobal",
    linkedinUrl: "https://www.linkedin.com/company/amritaglobal",
    xUrl: "https://x.com/amritaglobal",
    youtubeUrl: "https://www.youtube.com/@amritaglobal",
    pinterestUrl: "https://www.pinterest.com/amritaglobal",
  };
}

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

  // Fetch company information
  let company = await fetchCompanyInfo();

  // Use fallback if API fails
  if (!company) {
    console.warn("Using fallback company data for email");
    company = getFallbackCompanyData();
  }

  // Build dynamic values
  const companyName = company.legalName || "Amrita Global Enterprises";
  
  const phone1 = company.phone1 || "+91-9925155141";
  const phone2 = company.phone2 || "+91-9824003484";
  const phone1Dept = company.phone1Dept || "Sales";
  const phone2Dept = company.phone2Dept || "Director";
  const salesEmail = company.salesEmail || "sales@amrita-fashions.com";
  const supportEmail = company.supportEmail || "support@amrita-fashions.com";
  const addressStreet =
    company.addressStreet || "404, 4th Floor, Safal Prelude, Opp SPIPA";
  const addressCity = company.addressCity || "Ahmedabad";
  const addressState = company.addressState || "Gujarat";
  const addressCountry = company.addressCountry || "India";
  const addressPostalCode = company.addressPostalCode || "380015";
  const facebookUrl =
    company.facebookUrl || "https://www.facebook.com/amritaglobal";
  const instagramUrl =
    company.instagramUrl || "https://www.instagram.com/amritaglobal";
  const linkedinUrl =
    company.linkedinUrl || "https://www.linkedin.com/company/amritaglobal";
  const xUrl = company.xUrl || "https://x.com/amritaglobal";
  const youtubeUrl =
    company.youtubeUrl || "https://www.youtube.com/@amritaglobal";
  const pinterestUrl =
    company.pinterestUrl || "https://www.pinterest.com/amritaglobal";

  const htmlTemplate = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OTP Verification</title>
</head>
<body style="margin:0; padding:0; background:#eef2f7; font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7; padding:18px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background:#ffffff; border-radius:14px; overflow:hidden; box-shadow:0 10px 26px rgba(15,23,42,0.10);">
          <!-- Header -->
          <tr>
            <td style="background:#071a2e; padding:18px 18px 14px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" style="vertical-align:middle;">
                    <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/logo_white_qlqxqy.png" width="150" alt="${companyName}" style="display:block; border:0; outline:none; text-decoration:none; height:auto; max-width:150px;" />
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <div style="font-size:12px; font-weight:800; color:#ffffff;">${companyName}</div>
                    <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">Secure Verification</div>
                  </td>
                </tr>
              </table>
              <div style="height:3px; width:76px; background:#e0b44a; border-radius:2px; margin-top:12px;"></div>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:18px 18px 10px 18px;">
              <div style="font-size:13px; line-height:1.7; color:#0f172a;">
                Dear Sir/Madam,<br><br>
                Greetings from <strong>${companyName}</strong>.<br><br>
                As part of our secure verification process, please use the following One-Time Password (OTP) to continue:
              </div>
              <!-- OTP -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 8px 0;">
                <tr>
                  <td align="center">
                    <div style="display:inline-block; padding:12px 18px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0;">
                      <div style="font-size:11px; color:#64748b; font-weight:800; letter-spacing:0.6px; margin-bottom:6px;">OTP CODE</div>
                      <div style="font-size:28px; font-weight:900; letter-spacing:6px; color:#071a2e; line-height:1;">${otp}</div>
                    </div>
                    <div style="font-size:11px; color:#64748b; margin-top:8px;">Valid for ${ttlMinutes} minutes. Do not share this code.</div>
                  </td>
                </tr>
              </table>
              <div style="font-size:12.5px; line-height:1.7; color:#334155; margin-top:10px;">
                This code is strictly confidential. Kindly refrain from sharing it with any third party.<br><br>
                If this request was not initiated by you, please disregard this message.
              </div>
              <div style="margin-top:14px; border-top:1px solid #edf2f7;"></div>
              <!-- Compact Business Details -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <tr>
                  <td style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 12px;">
                    <div style="font-size:12px; font-weight:900; color:#0f172a; margin-bottom:8px;">Business Details</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:top; width:50%; padding-right:10px;">
                          <div style="font-size:11px; font-weight:900; color:#071a2e; margin-bottom:6px;">Contact</div>
                          <div style="font-size:11.5px; line-height:1.65; color:#334155;">
                            ${phone1Dept}: <a href="tel:${phone1}" style="color:#0b2a4a; text-decoration:none;">${phone1}</a><br>
                            ${phone2Dept}: <a href="tel:${phone2}" style="color:#0b2a4a; text-decoration:none;">${phone2}</a><br>
                            Sales: <a href="mailto:${salesEmail}" style="color:#0b2a4a; text-decoration:none;">${salesEmail}</a><br>
                            Support: <a href="mailto:${supportEmail}" style="color:#0b2a4a; text-decoration:none;">${supportEmail}</a>
                          </div>
                        </td>
                        <td style="vertical-align:top; width:50%; padding-left:10px;">
                          <div style="font-size:11px; font-weight:900; color:#071a2e; margin-bottom:6px;">Office</div>
                          <div style="font-size:11.5px; line-height:1.65; color:#334155;">
                            ${addressStreet}<br>
                            ${addressCity}, ${addressState}, ${addressCountry} – ${addressPostalCode}
                          </div>
                          <div style="font-size:11px; font-weight:900; color:#071a2e; margin:10px 0 4px 0;">Other Locations</div>
                          <div style="font-size:11.5px; line-height:1.65; color:#334155;">
                            Factory: Ramol Road – 382449<br>
                            Warehouse: Narol – 382405<br>
                            UAE: Ajman Free Zone
                          </div>
                        </td>
                      </tr>
                    </table>
                    <!-- Social Icons Row -->
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                      <tr>
                        <td style="font-size:11px; font-weight:900; color:#071a2e; padding-bottom:6px;">Follow Us</td>
                      </tr>
                      <tr>
                        <td>
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding-right:8px;">
                                <a href="${facebookUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/facebook_icon_qlqxqy.png" width="26" height="26" alt="Facebook" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                              <td style="padding-right:8px;">
                                <a href="${instagramUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/instagram_icon_qlqxqy.png" width="26" height="26" alt="Instagram" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                              <td style="padding-right:8px;">
                                <a href="${linkedinUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/linkedin_icon_qlqxqy.png" width="26" height="26" alt="LinkedIn" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                              <td style="padding-right:8px;">
                                <a href="${xUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/x_icon_qlqxqy.png" width="26" height="26" alt="X" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                              <td style="padding-right:8px;">
                                <a href="${youtubeUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/youtube_icon_qlqxqy.png" width="26" height="26" alt="YouTube" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                              <td>
                                <a href="${pinterestUrl}" style="text-decoration:none;">
                                  <img src="https://res.cloudinary.com/dqfuzexqo/image/upload/v1739779116/pinterest_icon_qlqxqy.png" width="26" height="26" alt="Pinterest" style="display:block; border-radius:8px; border:1px solid #e2e8f0; background:#ffffff;" />
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Signature -->
              <div style="font-size:12px; line-height:1.7; color:#475569; margin-top:12px;">
                Sincerely,<br>
                <strong style="color:#0f172a;">Verification Team</strong><br>
                ${companyName}<br>
                <a href="https://www.amritaglobal.com" style="color:#0b2a4a; text-decoration:none;">www.amritaglobal.com</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to,
    subject: `Your OTP Code - ${companyName}`,
    text:
      `Dear Sir/Madam,\n\n` +
      `Greetings from ${companyName}.\n\n` +
      `Your OTP is: ${otp}\n` +
      `This code will expire in ${ttlMinutes} minutes.\n\n` +
      `If you didn't request this, please ignore this email.\n\n` +
      `Sincerely,\nVerification Team\n${companyName}`,
    html: htmlTemplate,
  });
}

module.exports = { sendOtpEmail };
