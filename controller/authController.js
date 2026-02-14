const { espoRequest } = require("./espoClient");
const { sendOtpEmail } = require("../utils/mailer");
const {
  generateOtp,
  hashOtp,
  timingSafeEqual,
  parseEspoDate,
  formatEspoDate,
} = require("../utils/otp");

// Configuration from environment
const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const MAX_FAILS = Number(process.env.OTP_MAX_FAILS || 5);
const ENTITY_NAME = process.env.OTP_ENTITY || "CCustomerAccount";

/**
 * Find user by email address
 */
async function findUserByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase();

  // EspoCRM filter format for exact email match
  const data = await espoRequest(`/${ENTITY_NAME}`, {
    query: {
      "where[0][type]": "equals",
      "where[0][attribute]": "emailAddress",
      "where[0][value]": normalizedEmail,
      maxSize: 1,
    },
  });

  const list = data?.list || [];
  return list.length > 0 ? list[0] : null;
}

/**
 * Update user OTP fields
 */
async function updateUserOtp(userId, fields) {
  return await espoRequest(`/${ENTITY_NAME}/${userId}`, {
    method: "PUT",
    body: fields,
  });
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Request OTP - Send OTP code to user's email
 */
const requestOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Find user by email
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Check if login is allowed (if field exists)
    if (user.loginAllowed === false) {
      return res.status(403).json({
        success: false,
        message: "Login not allowed for this account",
      });
    }

    // Check email validity (if fields exist)
    if (user.emailAddressIsInvalid === true) {
      return res.status(400).json({
        success: false,
        message: "Email address is invalid",
      });
    }

    if (user.emailAddressIsOptedOut === true) {
      return res.status(400).json({
        success: false,
        message: "Email address has opted out",
      });
    }

    // Check cooldown period
    const lastSent = parseEspoDate(user.otplastsentat);
    if (lastSent) {
      const diffMs = Date.now() - lastSent.getTime();
      const remainingSeconds = Math.ceil(COOLDOWN_SECONDS - diffMs / 1000);

      if (diffMs < COOLDOWN_SECONDS * 1000) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${remainingSeconds} seconds before requesting another OTP`,
          remainingSeconds,
        });
      }
    }

    // Generate OTP
    const otp = generateOtp();
    const otpHash = hashOtp(otp, user.id);

    // Calculate expiration time
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

    // Update user with OTP data
    await updateUserOtp(user.id, {
      otphash: otpHash,
      otpexpiresat: formatEspoDate(expiresAt),
      otplastsentat: formatEspoDate(new Date()),
      otpfailcount: 0,
    });

    // Send OTP email
    await sendOtpEmail(
      user.emailAddress,
      user.firstName || user.name,
      otp,
      TTL_MINUTES,
    );

    console.log(`[OTP] Sent OTP to ${email} (User ID: ${user.id})`);

    return res.json({
      success: true,
      message: "OTP sent to your email",
      expiresIn: `${TTL_MINUTES} minutes`,
    });
  } catch (error) {
    console.error("[OTP] Request OTP error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP",
    });
  }
};

/**
 * Verify OTP - Validate the OTP code
 */
const verifyOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();
    const otp = String(req.body.otp || "").trim();

    // Validate inputs
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        success: false,
        message: "OTP must be 6 digits",
      });
    }

    // Find user by email
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    // Check if login is allowed
    if (user.loginAllowed === false) {
      return res.status(403).json({
        success: false,
        message: "Login not allowed for this account",
      });
    }

    // Check fail count
    const failCount = Number(user.otpfailcount || 0);
    if (failCount >= MAX_FAILS) {
      return res.status(429).json({
        success: false,
        message: "Too many failed attempts. Please request a new OTP",
      });
    }

    // Check if OTP exists
    if (!user.otphash) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new OTP",
      });
    }

    // Check expiration
    const expiresAt = parseEspoDate(user.otpexpiresat);
    if (!expiresAt || Date.now() > expiresAt.getTime()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one",
      });
    }

    // Verify OTP
    const expectedHash = hashOtp(otp, user.id);
    const isValid = timingSafeEqual(user.otphash, expectedHash);

    if (!isValid) {
      // Increment fail count
      await updateUserOtp(user.id, {
        otpfailcount: failCount + 1,
      });

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
        attemptsRemaining: MAX_FAILS - failCount - 1,
      });
    }

    // OTP is valid - clear OTP fields
    await updateUserOtp(user.id, {
      otphash: null,
      otpexpiresat: null,
      otpfailcount: 0,
    });

    console.log(
      `[OTP] Successfully verified OTP for ${email} (User ID: ${user.id})`,
    );

    // Return success with user data (exclude sensitive fields)
    return res.json({
      success: true,
      message: "OTP verified successfully",
      user: {
        id: user.id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        emailAddress: user.emailAddress,
      },
    });
  } catch (error) {
    console.error("[OTP] Verify OTP error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to verify OTP",
    });
  }
};

/**
 * Register - Create new customer account with OTP verification
 */
register = async (req, res) => {
  try {
    const { email, firstName, lastName, name, phoneNumber } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existingUser = await findUserByEmail(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Account with this email already exists",
      });
    }

    // Build user data - only include fields that have values
    const userData = {
      emailAddress: normalizedEmail,
      loginAllowed: true,
    };

    if (firstName) userData.firstName = firstName;
    if (lastName) userData.lastName = lastName;
    if (name) {
      userData.name = name;
    } else if (firstName || lastName) {
      userData.name = `${firstName || ""} ${lastName || ""}`.trim();
    } else {
      userData.name = normalizedEmail;
    }
    if (phoneNumber) userData.phoneNumber = phoneNumber;

    // Create new customer account
    const newUser = await espoRequest(`/${ENTITY_NAME}`, {
      method: "POST",
      body: userData,
    });

    console.log(
      `[AUTH] New account registered: ${normalizedEmail} (ID: ${newUser.id})`,
    );

    // Automatically send OTP after registration
    const otp = generateOtp();
    const otpHash = hashOtp(otp, newUser.id);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

    await updateUserOtp(newUser.id, {
      otphash: otpHash,
      otpexpiresat: formatEspoDate(expiresAt),
      otplastsentat: formatEspoDate(new Date()),
      otpfailcount: 0,
    });

    await sendOtpEmail(normalizedEmail, firstName || name, otp, TTL_MINUTES);

    return res.status(201).json({
      success: true,
      message: "Account created successfully. OTP sent to your email",
      user: {
        id: newUser.id,
        emailAddress: normalizedEmail,
        firstName: firstName || "",
        lastName: lastName || "",
        name: newUser.name,
      },
      expiresIn: `${TTL_MINUTES} minutes`,
    });
  } catch (error) {
    console.error("[AUTH] Registration error:", error);

    // Handle EspoCRM validation errors
    if (error.status === 400 && error.data?.messageTranslation) {
      const validation = error.data.messageTranslation;
      return res.status(400).json({
        success: false,
        message: `Validation failed: ${validation.data?.field || "unknown field"}`,
        details: validation,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to register account",
    });
  }
};

/**
 * Login - Request OTP for existing account
 */
const login = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    // Validate email
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Find user by email
    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found. Please register first",
      });
    }

    // Check if login is allowed
    if (user.loginAllowed === false) {
      return res.status(403).json({
        success: false,
        message: "Login not allowed for this account",
      });
    }

    // Check email validity
    if (user.emailAddressIsInvalid === true) {
      return res.status(400).json({
        success: false,
        message: "Email address is invalid",
      });
    }

    if (user.emailAddressIsOptedOut === true) {
      return res.status(400).json({
        success: false,
        message: "Email address has opted out",
      });
    }

    // Check cooldown period
    const lastSent = parseEspoDate(user.otplastsentat);
    if (lastSent) {
      const diffMs = Date.now() - lastSent.getTime();
      const remainingSeconds = Math.ceil(COOLDOWN_SECONDS - diffMs / 1000);

      if (diffMs < COOLDOWN_SECONDS * 1000) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${remainingSeconds} seconds before requesting another OTP`,
          remainingSeconds,
        });
      }
    }

    // Generate and send OTP
    const otp = generateOtp();
    const otpHash = hashOtp(otp, user.id);
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);

    await updateUserOtp(user.id, {
      otphash: otpHash,
      otpexpiresat: formatEspoDate(expiresAt),
      otplastsentat: formatEspoDate(new Date()),
      otpfailcount: 0,
    });

    await sendOtpEmail(
      user.emailAddress,
      user.firstName || user.name,
      otp,
      TTL_MINUTES,
    );

    console.log(`[AUTH] Login OTP sent to ${email} (User ID: ${user.id})`);

    return res.json({
      success: true,
      message: "OTP sent to your email",
      expiresIn: `${TTL_MINUTES} minutes`,
    });
  } catch (error) {
    console.error("[AUTH] Login error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process login",
    });
  }
};

module.exports = {
  register,
  login,
  requestOtp,
  verifyOtp,
};
