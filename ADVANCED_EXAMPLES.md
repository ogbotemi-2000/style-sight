/**
 * Advanced Usage Examples for Style Proxy Server
 * 
 * These examples show how to extend and customize the proxy server
 * for advanced use cases.
 */

// ============================================================================
// Example 1: Using the proxy with Puppeteer for headless testing
// ============================================================================

/*
const puppeteer = require('puppeteer');

async function testStylesWithPuppeteer() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Navigate through the proxy
  const targetUrl = 'https://example.com';
  const proxyUrl = `http://localhost:3000/proxy?target=${encodeURIComponent(targetUrl)}`;
  
  await page.goto(proxyUrl, { waitUntil: 'networkidle2' });
  
  // Inject custom CSS
  await page.addStyleTag({
    content: `
      * {
        border: 1px solid red !important;
      }
    `
  });
  
  // Take screenshot with modified styles
  await page.screenshot({ path: 'screenshot.png' });
  
  await browser.close();
}
*/

// ============================================================================
// Example 2: Custom header injection
// ============================================================================

/*
// Extend the server.js file to add custom headers:

function injectCustomHeaders(content, targetDomain) {
  // Add tracking or monitoring headers
  const headers = `
    <!-- Custom Headers Injected by Proxy -->
    <meta name="proxy-target" content="${targetDomain}">
    <meta name="proxy-timestamp" content="${new Date().toISOString()}">
    <script>
      console.log('Content loaded through proxy: ${targetDomain}');
    </script>
  `;
  
  const $ = cheerio.load(content);
  $('head').prepend(headers);
  return $.html();
}
*/

// ============================================================================
// Example 3: Style modification through proxy
// ============================================================================

/*
// Create a bookmarklet that uses the proxy:

const bookmarklet = `
javascript:(function(){
  const targetUrl = prompt('Enter URL to proxy:');
  if (targetUrl) {
    window.location = 'http://localhost:3000/proxy?target=' + encodeURIComponent(targetUrl);
  }
})();
`;

// Usage: Save as bookmark, click to instantly proxy any URL
*/

// ============================================================================
// Example 4: Using the proxy with a custom script modifier
// ============================================================================

/*
// Add this to server.js to modify scripts before execution:

function injectScriptModifications(content, targetDomain) {
  const $ = cheerio.load(content);
  
  // Inject debugging script at the top of body
  const debugScript = `
    <script>
      // Proxy debugging tools
      window.__PROXY_TARGET = '${targetDomain}';
      window.__PROXY_DEBUG = {
        logAllXHR: function() {
          const originalFetch = window.fetch;
          window.fetch = function(...args) {
            console.log('FETCH:', args[0]);
            return originalFetch.apply(this, args);
          };
        },
        logAllEvents: function() {
          document.addEventListener('click', (e) => {
            console.log('Click on:', e.target);
          }, true);
        }
      };
    </script>
  `;
  
  $('body').prepend(debugScript);
  return $.html();
}
*/

// ============================================================================
// Example 5: Request caching middleware
// ============================================================================

/*
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minute TTL

// Add this before the proxy endpoint:

app.use('/proxy', (req, res, next) => {
  const targetUrl = req.query.target;
  const cacheKey = `proxy:${targetUrl}`;
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log('Cache hit for:', targetUrl);
    return res.send(cached);
  }
  
  // Continue to proxy endpoint
  next();
});

// Then in the proxy endpoint, before sending response:
cache.set(cacheKey, content);
res.send(content);
*/

// ============================================================================
// Example 6: Advanced URL rewriting with substitutions
// ============================================================================

/*
function advancedRewriteUrls(content, targetDomain, rewrites = {}) {
  // Apply custom rewrites (e.g., to point to local mock servers)
  
  let rewritten = content;
  
  // Apply custom substitution rules
  Object.entries(rewrites).forEach(([find, replace]) => {
    const regex = new RegExp(find, 'g');
    rewritten = rewritten.replace(regex, replace);
  });
  
  // Then apply standard URL rewriting
  return rewriteUrls(rewritten, targetDomain, '/proxy');
}

// Usage:
const rewrites = {
  'https://api.example.com': 'http://localhost:3001/mock-api',
  'https://cdn.example.com': 'http://localhost:3002/mock-cdn',
};
*/

// ============================================================================
// Example 7: Creating a proxy with authentication
// ============================================================================

/*
// Add JWT authentication to proxy requests:

const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use('/proxy', (req, res, next) => {
  const token = req.query.token || req.headers.authorization;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Generate token:
const token = jwt.sign({ user: 'developer' }, SECRET, { expiresIn: '1h' });
console.log('Token:', token);
*/

// ============================================================================
// Example 8: Creating a web UI for the proxy
// ============================================================================

/*
app.get('/ui', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Proxy UI</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0; display: flex; height: 100vh; }
        .sidebar { width: 300px; background: #fff; border-right: 1px solid #ddd; padding: 20px; overflow-y: auto; }
        .main { flex: 1; display: flex; flex-direction: column; }
        .toolbar { background: #fff; border-bottom: 1px solid #ddd; padding: 15px 20px; display: flex; gap: 10px; }
        .toolbar input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
        .toolbar button { padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        .toolbar button:hover { background: #0056b3; }
        iframe { flex: 1; border: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="sidebar">
          <h2>Style Proxy</h2>
          <div style="margin-top: 20px;">
            <h3>Bookmarks</h3>
            <ul id="bookmarks" style="list-style: none; margin-top: 10px;"></ul>
          </div>
        </div>
        <div class="main">
          <div class="toolbar">
            <input type="url" id="targetUrl" placeholder="https://example.com" value="https://example.com">
            <button onclick="loadUrl()">Load</button>
          </div>
          <iframe id="content"></iframe>
        </div>
      </div>
      <script>
        function loadUrl() {
          const url = document.getElementById('targetUrl').value;
          const proxyUrl = \`/proxy?target=\${encodeURIComponent(url)}\`;
          document.getElementById('content').src = proxyUrl;
          saveBookmark(url);
        }
        
        function saveBookmark(url) {
          let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
          if (!bookmarks.includes(url)) {
            bookmarks.unshift(url);
            bookmarks = bookmarks.slice(0, 10); // Keep last 10
            localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
            renderBookmarks();
          }
        }
        
        function renderBookmarks() {
          const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
          const list = document.getElementById('bookmarks');
          list.innerHTML = bookmarks.map(url => \`
            <li style="margin: 8px 0;">
              <a href="javascript:;" onclick="document.getElementById('targetUrl').value='${url}'; loadUrl(); return false;">
                \${new URL(url).hostname}
              </a>
            </li>
          \`).join('');
        }
        
        renderBookmarks();
        document.getElementById('targetUrl').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') loadUrl();
        });
      </script>
    </body>
    </html>
  `);
});
*/

// ============================================================================
// Example 9: Style extraction and analysis
// ============================================================================

/*
app.get('/analyze', async (req, res) => {
  const targetUrl = req.query.target;
  
  const response = await axios.get(`http://localhost:3000/proxy?target=${encodeURIComponent(targetUrl)}`);
  const $ = cheerio.load(response.data);
  
  // Extract all stylesheets
  const stylesheets = [];
  $('link[rel="stylesheet"]').each((i, el) => {
    stylesheets.push($(el).attr('href'));
  });
  
  // Extract inline styles
  const inlineStyles = [];
  $('[style]').each((i, el) => {
    inlineStyles.push({
      element: el.name,
      style: $(el).attr('style')
    });
  });
  
  res.json({
    url: targetUrl,
    stylesheets,
    inlineStylesCount: inlineStyles.length,
    inlineStyles: inlineStyles.slice(0, 10) // First 10
  });
});
*/

console.log(`
These examples show how to extend the basic proxy server with:
1. Puppeteer integration for headless testing
2. Custom header injection
3. Style modification through proxy
4. Script modification and debugging
5. Response caching
6. Advanced URL rewriting with substitutions
7. Authentication and authorization
8. Web UI for easier interaction
9. Style analysis and extraction

Uncomment and adapt these examples to your needs!
`);
