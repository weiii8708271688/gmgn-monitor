import { google } from 'googleapis';
import fs from 'fs';
import readline from 'readline';

const CLIENT_SECRET_PATH = './google-oauth-client.json';
const TOKEN_PATH = './google-token.json';

const credentials = JSON.parse(fs.readFileSync(CLIENT_SECRET_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.installed;

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

console.log('請用瀏覽器開啟以下網址授權：\n');
console.log(authUrl);
console.log('\n授權後，將網址列上的 code 參數值貼到這裡：');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('> ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`\n✅ 授權成功！Token 已儲存到 ${TOKEN_PATH}`);
  } catch (error) {
    console.error('授權失敗:', error.message);
  }
});
