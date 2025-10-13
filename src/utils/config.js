const { query } = require('../mysql');

// Cache for storing configuration
const configCache = new Map();

/**
 * Get configuration for a specific admin ID
 * @param {number} adminId - The admin ID to get configuration for
 * @returns {Promise<Object>} Configuration object
 */
async function getConfig(adminId) {
    // Check if config is in cache
    if (configCache.has(adminId)) {
        return configCache.get(adminId);
    }

    try {
        const results = await query(
            'SELECT * FROM zk_config WHERE aid = ?',
            [adminId]
        );

        let config = {};
        if (results && results.length > 0) {
            // Convert array of rows to object
            config = results[0];
            // Cache the result
            configCache.set(adminId, config);
        }

        return config;
    } catch (error) {
        console.error('Error fetching zk_config:', error);
        throw error;
    }
}

/**
 * Clear the configuration cache for a specific admin or all admins
 * @param {number} [adminId] - Optional admin ID to clear cache for. If not provided, clears all caches.
 */
function clearCache(adminId) {
    if (adminId) {
        configCache.delete(adminId);
    } else {
        configCache.clear();
    }
}

module.exports = {
    getConfig,
    clearCache
};