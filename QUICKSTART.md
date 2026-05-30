# 🚀 Quick Start Guide

Get the proxy server running in 3 minutes!

## Step 1: Install Dependencies

```bash
npm install
```

Or on Windows, just double-click `start.bat` (it does this automatically)

## Step 2: Start the Server

### Linux/Mac:
```bash
npm start
```

Or use:
```bash
bash start.sh
```

### Windows:
Double-click `start.bat` or run:
```bash
npm start
```

You should see:
```
╔══════════════════════════════════════════════╗
║   🔄 Style Proxy Server Started              ║
╚══════════════════════════════════════════════╝

📍 Server running at: http://localhost:3000
```

## Step 3: Use the Proxy

### In Your Browser:

Open this URL:
```
http://localhost:3000/proxy?target=https://example.com
```

Replace `example.com` with any website you want to inspect!

### Examples:

```
http://localhost:3000/proxy?target=https://github.com
http://localhost:3000/proxy?target=https://google.com
http://localhost:3000/proxy?target=https://wikipedia.org
```

## Inspecting Styles

1. Open the proxy URL in your browser
2. Press **F12** to open DevTools
3. Go to the **Elements** tab
4. Inspect and modify CSS in real-time!

### Pro Tips:

✨ **Edit styles live:** Click on any style rule in DevTools and modify it
📸 **Take screenshots:** You can now see how the site looks with your CSS changes
🎨 **Copy modified CSS:** Select all modified rules and copy them
🔍 **Debug layout:** Use the element inspector as normal

## Common Tasks

### Modify a Specific Style

```
1. Open proxy URL
2. Press F12
3. Find the element you want to modify
4. Edit the CSS in the Styles panel
5. Changes apply instantly!
```

### Test Responsive Design

```
1. Open proxy URL
2. Press F12
3. Click the device toolbar (Ctrl+Shift+M)
4. Choose a device or custom size
5. Modify styles for different breakpoints
```

### Export Modified Styles

```
1. In DevTools, right-click on a style rule
2. Copy the modified rule
3. Paste into your CSS file
4. Done!
```

## Troubleshooting

### "Cannot GET /proxy"
- Make sure the server is running (`npm start`)
- Check that you're using the correct URL format

### "Domain not allowed"
- By default, all domains are allowed
- If you see this error, check your `.env` file's `ALLOWED_DOMAINS`

### CSS not loading
- Check the browser console for errors (F12 → Console)
- Make sure the target website is accessible
- Try a simpler website first (like example.com)

### Website looks broken
- This is normal for complex websites
- Some JavaScript may not work due to domain context changes
- The important thing is that you can inspect and modify the CSS

## Next Steps

Once you're comfortable with the basics:

1. **Read the full README:** For advanced features and configuration
2. **Check ADVANCED_EXAMPLES.md:** For integration ideas
3. **Run test-proxy.js:** To test programmatic access:
   ```bash
   node test-proxy.js https://example.com
   ```

## Environment Variables (Optional)

Create a `.env` file to customize behavior:

```env
# Allow only specific domains (comma-separated)
ALLOWED_DOMAINS=github.com,example.com

# Change the port
PORT=8080
```

## Development Mode

For development with auto-reload:

```bash
npm run dev
```

This requires `nodemon` (already installed).

## What's Happening?

The proxy server:

1. ✅ Fetches your target website
2. ✅ Modifies headers to allow cross-domain rendering
3. ✅ Rewrites all URLs so resources load through the proxy
4. ✅ Returns the processed page to your browser
5. ✅ You can now inspect and modify styles!

```
Your Browser
    ↓ (http://localhost:3000/proxy?target=...)
Proxy Server
    ↓ (fetches content, modifies headers, rewrites URLs)
Target Website (https://example.com)
    ↓ (returns content)
Your Browser (displays with modified styles available)
```

## Tips & Tricks

### 💡 Bookmark the Proxy

1. Proxy a website you frequently inspect
2. Bookmark the proxy URL
3. Click the bookmark anytime to instantly proxy that site

### 💡 Multiple Windows

Open multiple proxy URLs side-by-side to compare styles

### 💡 CSS Testing Workflow

1. Modify CSS in DevTools
2. Take screenshots of changes
3. Copy the CSS changes
4. Apply to your actual CSS file
5. Test in production

### 💡 Performance Testing

1. Open DevTools (F12)
2. Go to Network tab
3. Proxy a website and inspect all requests
4. Identify slow resources
5. Analyze with your local tools

## Ports and URLs

- **Main proxy:** http://localhost:3000
- **Proxy endpoint:** http://localhost:3000/proxy?target=URL
- **Health check:** http://localhost:3000/health
- **Info page:** http://localhost:3000/

## Still Need Help?

1. Check the full [README.md](README.md)
2. Look at [ADVANCED_EXAMPLES.md](ADVANCED_EXAMPLES.md)
3. Review the [server.js](server.js) comments
4. Check browser console (F12) for errors

---

**Happy style inspecting! 🎨**
