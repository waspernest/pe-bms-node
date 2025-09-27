const path = require('path');
const fs = require('fs');

// Path to config file from project root
if (process.pkg) {
  // Running from a pkg binary (like backend-win.exe)
  configPath = path.join(path.dirname(process.execPath), 'config.json');
} else {
  // Running via `node src/server.js` in development
  configPath = path.join(__dirname, '../../../backend-server/config.json');
}

// Default config in case the file doesn't exist
const defaultConfig = {
    initial_setup: true
};

exports.getConfigPath = () => {
    return configPath;
};

exports.getConfig = () => {
    try {
        // Check if file exists
        if (!fs.existsSync(configPath)) {
            // Create default config file if it doesn't exist
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
            return { ...defaultConfig };
        }
        
        // Read and parse the config file
        const fileContent = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(fileContent);
    } catch (err) {
        console.error('Failed to read/write config.json:', err.message);
        // Return default config on error
        return { ...defaultConfig };
    }
};

exports.writeConfig = (config) => {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        return true; // Return true on success
    } catch (err) {
        console.error('Failed to write config.json:', err.message);
        return false; // Return false on failure
    }
};