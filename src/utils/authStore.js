const Store = require('electron-store');

const schema = {
  auth: {
    type: 'object',
    properties: {
      user: { type: 'object' },
      token: { type: 'string' },
      lastLogin: { type: 'string', format: 'date-time' }
    },
    default: {}
  }
};

const store = new Store({ schema });

const saveAuthData = (data) => {
  store.set('auth', {
    user: data.user,
    token: data.token,
    lastLogin: new Date().toISOString()
  });};

const getAuthData = () => store.get('auth');

const clearAuthData = () => {
  store.delete('auth');};

module.exports = {
  saveAuthData,
  getAuthData,
  clearAuthData
};
