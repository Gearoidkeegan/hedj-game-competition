# CloudFront security headers for competition.hedj.eu

A response-headers policy to attach by hand to the competition distribution. It is not managed by the SAM stack.

## PREREQUISITE: do not attach the CSP yet (cutover task H attaches it)

Today `css/retro.css` has `@import url('https://fonts.googleapis.com/...')` for Press Start 2P and VT323. The CSP below
allows only `'self'` for styles and fonts, so with it attached those fonts silently fail to load and the whole UI falls
back to a system monospace font.

Do not attach the CSP until the later PWA task has:

1. self-hosted the fonts (woff2 under `assets/`, `@font-face` in CSS), and
2. removed the Google Fonts `@import`s and `<link>`s.

The cutover task (H) attaches this policy, after the checklist at the bottom is clear. The other three headers (HSTS,
`X-Content-Type-Options`, `Referrer-Policy`) have no such dependency and may be attached earlier by dropping the CSP
entry from the config.

## Policy

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (no `preload` until the whole domain is ready) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

`connect-src 'self'` works because the frontend calls the API same-origin at `/api` (a CloudFront behaviour to the API
Gateway origin). `style-src 'unsafe-inline'` is needed for the existing inline `<style>` blocks.

## Steps

1. Save the config as `competition-headers.json`:

```json
{
  "Name": "hedj-competition-security-headers",
  "Comment": "CSP, HSTS, nosniff and referrer policy for competition.hedj.eu",
  "SecurityHeadersConfig": {
    "ContentSecurityPolicy": {
      "Override": true,
      "ContentSecurityPolicy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'"
    },
    "StrictTransportSecurity": {
      "Override": true,
      "AccessControlMaxAgeSec": 31536000,
      "IncludeSubdomains": true,
      "Preload": false
    },
    "ContentTypeOptions": { "Override": true },
    "ReferrerPolicy": { "Override": true, "ReferrerPolicy": "strict-origin-when-cross-origin" }
  }
}
```

2. Create the policy and note the returned `Id`:

```sh
aws cloudfront create-response-headers-policy \
  --response-headers-policy-config file://competition-headers.json \
  --query 'ResponseHeadersPolicy.Id' --output text
```

3. Before touching any distribution, confirm which one it is. **Never attach to the hedj.eu distribution — verify `$CF_COMP_DISTRIBUTION_ID`'s aliases are competition.hedj.eu first:**

```sh
aws cloudfront get-distribution --id "$CF_COMP_DISTRIBUTION_ID" --query 'Distribution.DistributionConfig.Aliases.Items'
```

   Then fetch the distribution config (keep the `ETag`) and edit it:

```sh
aws cloudfront get-distribution-config --id "$CF_COMP_DISTRIBUTION_ID" > dist.json
ETAG=$(jq -r .ETag dist.json)
jq '.DistributionConfig' dist.json > dist-config.json
```

In `dist-config.json`, set `ResponseHeadersPolicyId` to the new Id on the default cache behaviour and on any other
behaviour that serves HTML or JS (not the `/api/*` behaviour, whose responses come from API Gateway).

4. Apply it:

```sh
aws cloudfront update-distribution --id "$CF_COMP_DISTRIBUTION_ID" \
  --distribution-config file://dist-config.json --if-match "$ETAG"
```

5. Verify after deployment (about a minute):

```sh
curl -sI https://competition.hedj.eu/ | grep -iE 'content-security|strict-transport|x-content-type|referrer-policy'
```

Then load the game, `stand.html` and `admin.html` with the browser console open and confirm there are no CSP violations.

## Blockers for task H (existing inline script and font loads)

`script-src 'self'` blocks every inline `<script>` and every `on*=` attribute. Audit of the current pages:

| Page | Finding | Needed for H |
| --- | --- | --- |
| `index.html` | One external module (`js/main.js`). No inline script, no `on*=` handlers. | Nothing. |
| `privacy.html` | No script, no handlers. | Nothing. |
| `stand.html` | External `js/stand.js` only. | Nothing. |
| `admin.html` | One inline `<script>` block (~line 271) and inline handlers `onclick="login()"`, `onclick="downloadCSV()"`, `onclick="refresh()"`, plus the prize buttons added in E1-3 (`onclick="downloadPrize(...)"`). | **Blocker.** Move the script to `js/admin.js` and bind with `addEventListener`. Admin would otherwise be dead once the CSP is attached. |
| `admin.html`, `privacy.html`, `stand.html` | `<link>` to `fonts.googleapis.com`. | Replace with the self-hosted fonts. |
| `css/retro.css` | `@import` of Google Fonts (lines 7-8). | Replace with self-hosted `@font-face` (see prerequisite). |

A grep of `js/**` found no inline `on*=` handlers in injected markup.
