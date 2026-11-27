# Clean profile URLs (`/u/username`)

The site opens profiles at `/u/cas` style paths.

## Static hosting

Most static hosts need a rewrite so `/u/*` serves `index.html`:

**Vercel** (`vercel.json`):
```json
{ "rewrites": [{ "source": "/u/(.*)", "destination": "/index.html" }] }
```

**Netlify** (`_redirects`):
```
/u/*  /index.html  200
```

**GitHub Pages / plain nginx**: use hash links `#u=username` (still supported) or configure try_files.

Hash links `#u=username` continue to work with no server config.
