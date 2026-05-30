#!/usr/bin/env node

/**
 * Test script for the Style Proxy Server
 * Usage: node test-proxy.js <target-url>
 * 
 * Examples:
 *   node test-proxy.js https://example.com
 *   node test-proxy.js https://github.com
 *   node test-proxy.js "https://example.com/page?query=value"
 */

const axios = require('axios');
const url = require('url');

const PROXY_URL = 'http://localhost:3000/proxy';
const DEFAULT_TARGET = 'https://example.com';

// Get target URL from command line or use default
const targetUrl = process.argv[2] || DEFAULT_TARGET;

console.log(`
╔════════════════════════════════════════════╗
║   Style Proxy Server - Test Script         ║
╚════════════════════════════════════════════╝
`);

console.log(`📍 Proxy Server: ${PROXY_URL}`);
console.log(`🎯 Target URL: ${targetUrl}`);
console.log(`🔗 Full Request: ${PROXY_URL}?target=${encodeURIComponent(targetUrl)}\n`);

// Validate URL
try {
  new url.URL(targetUrl);
} catch {
  console.error('❌ Invalid URL format');
  process.exit(1);
}

// Make proxy request
(async () => {
  try {
    console.log('⏳ Fetching content...');
    
    const response = await axios.get(PROXY_URL, {
      params: { target: targetUrl },
      timeout: 30000,
    });

    console.log(`✅ Request successful!\n`);
    
    // Show response info
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers['content-type']}`);
    console.log(`Content-Length: ${response.data.length} bytes`);
    
    // Show headers that were modified
    console.log('\nModified Headers:');
    console.log(`  Access-Control-Allow-Origin: ${response.headers['access-control-allow-origin']}`);
    console.log(`  Access-Control-Allow-Methods: ${response.headers['access-control-allow-methods']}`);
    console.log(`  Content-Security-Policy: ${response.headers['content-security-policy']?.substring(0, 50)}...`);
    
    // Show sample of content
    console.log('\nContent Preview (first 500 characters):');
    console.log('─'.repeat(60));
    console.log(response.data.substring(0, 500));
    console.log('─'.repeat(60));
    
    console.log(`\n✅ Test completed successfully!\n`);
    console.log('💡 Tips:');
    console.log(`   1. Open in browser: ${PROXY_URL}?target=${encodeURIComponent(targetUrl)}`);
    console.log('   2. Press F12 to open DevTools');
    console.log('   3. Inspect and modify styles in real-time');
    
  } catch (error) {
    console.error('❌ Request failed!\n');
    
    if (error.code === 'ECONNREFUSED') {
      console.error('Error: Could not connect to proxy server');
      console.error('Make sure to start the server first: npm start');
    } else if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Message: ${error.response.data?.error || error.message}`);
    } else {
      console.error(`Error: ${error.message}`);
    }
    
    process.exit(1);
  }
})();
