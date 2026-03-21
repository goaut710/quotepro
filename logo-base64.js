// Logo de Constructora D'Sanchez en base64
module.exports = require('fs').readFileSync(require('path').join(__dirname, 'public', 'logo.jpg')).toString('base64');
