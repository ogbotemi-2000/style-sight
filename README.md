# Style Proxy Server

A powerful Node.js proxy server for inspecting and modifying styles from any webpage by rendering it under a different domain. Perfect for style inspection, CSS debugging, and cross-domain style modification testing.

## Features

✅ **Cross-Domain Rendering** - View any website through the proxy on localhost
✅ **CORS & Header Workarounds** - Automatically handles CORS, CSP, and X-Frame-Options
✅ **URL Rewriting** - Intelligently rewrites all URLs in HTML, CSS, and JavaScript
✅ **Style Inspection** - Open DevTools and inspect/modify styles in real-time
✅ **Production Ready** - Handles various edge cases and content types
✅ **Configurable** - Control which domains are allowed, enable/disable features
✅ **Request Logging** - Optional logging for debugging

## Quick Start

### Installation

```bash
cd proxy-server
npm install
```

### Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000`

### Basic Usage

1. **Access a website through the proxy:**
   ```
   http://localhost:3000/proxy?target=https://example.com
   ```

2. **Open DevTools (F12) to inspect and modify styles**

3. **Changes apply in real-time** for testing purposes

## API Endpoints

### GET /proxy

Main proxy endpoint that fetches and processes content from target domains.

**Parameters:**
- `target` (required): Full URL of the page to proxy

**Examples:**
```bash
# Simple page request
curl "http://localhost:3000/proxy?target=https://example.com"

# Specific page
curl "http://localhost:3000/proxy?target=https://example.com/about"

# With query parameters (URL encode everything)
curl "http://localhost:3000/proxy?target=https://example.com/search%3Fq%3Dtest"
```

### GET /health

Health check endpoint to verify server is running.

```bash
curl http://localhost:3000/health
```

### GET /

Root endpoint with usage information and documentation.

```bash
# Visit in browser
http://localhost:3000/
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# Copy from example
cp .env.example .env
```

**Available variables:**

```env
# Comma-separated list of allowed domains, or '*' for all
ALLOWED_DOMAINS=*

# Server port
PORT=3000

# Require API key authentication for /proxy
AUTH_REQUIRED=false
PROXY_API_KEYS=

# Production-safe rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# Feature toggles
MODIFY_CSP=true
MODIFY_X_FRAME_OPTIONS=true
REWRITE_URLS=true
LOG_REQUESTS=true
```

### Feature Toggles

Use the `CONFIG` values in `server.js` or override them with environment variables:

```javascript
const CONFIG = {
  allowedDomains: [...],      // Domain whitelist
  modifyCSP: true,            // Remove/replace CSP headers
  modifyXFrameOptions: true,  // Remove X-Frame-Options
  rewriteUrls: true,          // Rewrite URLs in content
  logRequests: true,          // Enable request logging
};
```

## How It Works

### 1. Request Handling

When you request `/proxy?target=https://example.com`:

1. Server validates the target URL
2. Checks if domain is whitelisted
3. Fetches content from target with original headers
4. Processes the response

### 2. Header Modification

The server automatically:
- ✅ Removes Content-Security-Policy headers
- ✅ Removes X-Frame-Options headers
- ✅ Removes Referrer-Policy headers
- ✅ Removes Strict-Transport-Security headers
- ✅ Adds permissive CORS headers
- ✅ Adds permissive CSP rules

This allows the content to render properly cross-domain.

### 3. URL Rewriting

All URLs are intelligently rewritten:

**HTML URLs:**
```html
<!-- Before -->
<a href="/about">About</a>
<img src="image.png">

<!-- After -->
<a href="/proxy?target=https://example.com/about">About</a>
<img src="/proxy?target=https://example.com/image.png">
```

**CSS URLs:**
```css
/* Before */
background: url('/assets/bg.png');

/* After */
background: url('/proxy?target=https://example.com/assets/bg.png');
```

**Handled patterns:**
- Relative URLs
- Absolute URLs
- Protocol-relative URLs (`//cdn.example.com/file.js`)
- Data URIs and JavaScript URLs (preserved)
- CSS `url()` functions
- CSS `@import` statements

### 4. Content Type Handling

- **HTML** - Full processing with URL rewriting
- **CSS** - URL rewriting in styles
- **JavaScript** - URL rewriting (careful, as it can break code)
- **Other** - Passed through with modified headers

## Use Cases

### 1. Cross-Domain Style Testing

Test CSS modifications on third-party sites:

```javascript
// In DevTools console
// Styles are now inspectable and modifiable
```

### 2. Security Testing

Test how applications behave when served from different domains.

### 3. Local Development

Mock external websites during development:

```javascript
// Replace API calls to point to local mock servers
```

### 4. Archive & Offline Viewing

Cache and view websites offline with modified resources.

## Advanced Usage

### Domain Whitelisting

Only allow specific domains:

```bash
ALLOWED_DOMAINS=example.com,cdn.example.org npm start
```

### Development Mode with Auto-Reload

```bash
npm run dev
```

Uses `nodemon` to automatically restart on file changes.

### Programmatic Usage

```javascript
const axios = require('axios');

// Fetch through proxy programmatically
const response = await axios.get(
  'http://localhost:3000/proxy',
  { params: { target: 'https://example.com' } }
);

console.log(response.data);
```

## Limitations & Considerations

⚠️ **Security:**
- This proxy is designed for local development/inspection only
- Do not expose to untrusted networks
- Be aware that JavaScript execution may behave differently

⚠️ **Functionality:**
- Some JavaScript that depends on domain context may break
- WebSocket connections are not supported
- Dynamic content loading via fetch/XMLHttpRequest may have issues
- Some third-party scripts may actively block or detect proxying

⚠️ **Performance:**
- 30-second request timeout
- Large files may take time to process
- URL rewriting is CPU-intensive for large documents

## Troubleshooting

### "Domain not allowed" error

The target domain is not in the whitelist. Either:

```bash
ALLOWED_DOMAINS=* npm start
```

Or add the domain to `ALLOWED_DOMAINS`.

### CSS not loading

1. Check the browser console for failed requests
2. Ensure URL rewriting is enabled (`rewriteUrls: true`)
3. Check that the target CSS file is accessible

### JavaScript errors

JavaScript may behave differently under a different domain. Common issues:

- Cross-origin AJAX calls (will fail unless target allows it)
- Session/auth checks
- Referrer-based security

### Blank or broken pages

1. Check browser console for errors
2. Try with a simpler website first
3. Verify the target URL is correct

## Performance Tips

- Use `ALLOWED_DOMAINS` to restrict to specific sites
- Consider disabling URL rewriting if not needed
- Use local caching for frequently accessed resources

## Architecture

```
┌─────────────────┐
│   Browser       │
└────────┬────────┘
         │ http://localhost:3000/proxy?target=...
         ↓
┌─────────────────────────────────────────┐
│   Proxy Server (Node.js/Express)        │
├─────────────────────────────────────────┤
│ • Request Validation                    │
│ • Domain Whitelisting                   │
│ • Header Modification                   │
│ • Content Processing                    │
│ • URL Rewriting                         │
└────────┬────────────────────────────────┘
         │ https://target-domain.com
         ↓
┌─────────────────┐
│  Target Domain  │
└─────────────────┘
```

## Development

### Project Structure

```
proxy-server/
├── server.js           # Main application
├── package.json        # Dependencies
├── .env.example        # Environment template
├── README.md           # This file
└── .gitignore          # Git ignore rules
```

### Adding Features

To add new features:

1. Modify the `server.js` file
2. Add configuration options to `CONFIG`
3. Create helper functions as needed
4. Test with various websites
5. Document changes in README

### Dependencies

- **Express** - Web framework
- **Axios** - HTTP client
- **Cheerio** - HTML parsing & manipulation
- **url-join** - URL joining utility

## License

MIT

## Support

For issues or questions:

1. Check the Troubleshooting section
2. Review browser console errors
3. Check server logs for proxy errors
4. Test with a simple website first

---

**Made for style inspection, debugging, and development testing.**
