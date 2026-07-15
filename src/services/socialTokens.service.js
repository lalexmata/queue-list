/**
 * Social tokens service
 * Stores and retrieves OAuth tokens from the database
 */

const db = require("../database/db");

class SocialTokenService {
  /**
   * Save token for a platform
   */
  static async saveToken(platform, accessToken, refreshToken, expiresAt, userId = "main", otherData = null) {
    const query = `
      INSERT INTO social_tokens (platform, access_token, refresh_token, expires_at, user_id, other_data, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (platform, user_id) 
      DO UPDATE SET 
        access_token = $2,
        refresh_token = $3,
        expires_at = $4,
        other_data = $6,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    try {
      const result = await db.query(query, [
        platform,
        accessToken,
        refreshToken || null,
        expiresAt || null,
        userId,
        otherData ? JSON.stringify(otherData) : null,
      ]);
      return result.rows[0];
    } catch (e) {
      console.error(`Error saving ${platform} token:`, e.message);
      throw e;
    }
  }

  /**
   * Get token for a platform
   */
  static async getToken(platform, userId = "main") {
    const query = `
      SELECT * FROM social_tokens 
      WHERE platform = $1 AND user_id = $2
      LIMIT 1;
    `;

    try {
      const result = await db.query(query, [platform, userId]);
      return result.rows[0] || null;
    } catch (e) {
      console.error(`Error getting ${platform} token:`, e.message);
      return null;
    }
  }

  /**
   * Delete token for a platform
   */
  static async deleteToken(platform, userId = "main") {
    const query = `
      DELETE FROM social_tokens 
      WHERE platform = $1 AND user_id = $2;
    `;

    try {
      const result = await db.query(query, [platform, userId]);
      return result.rowCount > 0;
    } catch (e) {
      console.error(`Error deleting ${platform} token:`, e.message);
      throw e;
    }
  }

  /**
   * Check if token exists and is valid
   */
  static async hasValidToken(platform, userId = "main") {
    const token = await this.getToken(platform, userId);
    if (!token) return false;
    
    // Check if expired
    if (token.expires_at) {
      return new Date(token.expires_at) > new Date();
    }
    
    return !!token.access_token;
  }

  /**
   * Update refresh token (for platforms that rotate tokens)
   */
  static async updateRefreshToken(platform, newAccessToken, newRefreshToken, expiresAt, userId = "main") {
    const query = `
      UPDATE social_tokens 
      SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = CURRENT_TIMESTAMP
      WHERE platform = $4 AND user_id = $5
      RETURNING *;
    `;

    try {
      const result = await db.query(query, [
        newAccessToken,
        newRefreshToken || null,
        expiresAt || null,
        platform,
        userId,
      ]);
      return result.rows[0] || null;
    } catch (e) {
      console.error(`Error updating ${platform} token:`, e.message);
      throw e;
    }
  }
}

module.exports = SocialTokenService;
