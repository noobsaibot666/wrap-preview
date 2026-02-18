
const fs = require('fs');
const path = '/Users/alan/Library/Caches/wrap-preview/ca5cdcf35086f726/thumb_0.jpg';

if (fs.existsSync(path)) {
    const bytes = fs.readFileSync(path);
    const b64 = bytes.toString('base64');
    console.log('Base64 length:', b64.length);
    console.log('Prefix:', b64.substring(0, 50));
    console.log('Suffix:', b64.substring(b64.length - 50));
} else {
    console.log('File not found');
}
