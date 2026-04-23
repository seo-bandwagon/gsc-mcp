#!/usr/bin/env node

import { OAuthManager } from './oauth.js';
import { getConfig } from '../utils/config.js';

async function main() {
  console.log('Google Search Console MCP Server - Authentication\n');

  const config = getConfig();

  if (!config.clientId || !config.clientSecret) {
    console.error('Error: Missing required environment variables.');
    console.error('Please set GSC_CLIENT_ID and GSC_CLIENT_SECRET.\n');
    console.error('You can get these from the Google Cloud Console:');
    console.error('1. Go to https://console.cloud.google.com/apis/credentials');
    console.error('2. Create OAuth 2.0 Client ID credentials');
    console.error('3. Set the redirect URI to: http://localhost:3000/callback\n');
    process.exit(1);
  }

  const oauth = new OAuthManager(config);

  // Check if already authenticated
  const isAuth = await oauth.isAuthenticated();
  if (isAuth) {
    console.log('Already authenticated!');
    console.log(`Tokens stored at: ${config.tokenPath}\n`);

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('Do you want to re-authenticate? (y/N): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log('Keeping existing authentication.');
      process.exit(0);
    }
  }

  try {
    console.log('Starting authentication flow...');
    await oauth.authenticate();
    console.log('\n✓ Authentication successful!');
    console.log(`Tokens saved to: ${config.tokenPath}`);
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Authentication failed:', error);
    process.exit(1);
  }
}

main();
