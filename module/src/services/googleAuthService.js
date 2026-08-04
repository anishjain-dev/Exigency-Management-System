/**
 * googleAuthService.js
 *
 * Verifies the Google Identity Services ID token sent by the report form's
 * "Sign in with Google" button, so the submitter's email comes from a
 * cryptographically verified Google session rather than a free-text field
 * the user could type anything into.
 */

const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * @param {string} idToken - the credential returned by Google Identity Services
 * @return {Promise<{email: string, name: string} | null>} null if invalid/expired/wrong audience
 */
async function verifyGoogleIdToken(idToken) {
  if (!idToken || !process.env.GOOGLE_CLIENT_ID) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.email_verified) return null;
    return { email: payload.email, name: payload.name || '' };
  } catch (error) {
    return null;
  }
}

module.exports = { verifyGoogleIdToken };
