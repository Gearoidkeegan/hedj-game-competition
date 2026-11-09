# CloudFront security headers for competition.hedj.eu

A response-headers policy to attach by hand to the competition distribution. It is not managed by the SAM stack.

## When to attach it

The v3 site is ready for this policy (see "Readiness audit" at the bottom). Attach it during cutover, after the v3
frontend is deployed and before the phone dry run, so the dry run also proves nothing is blocked
(`docs/cutover.md`, section F).

Do **not** attach it while the old (v2) frontend is still live: the old pages load Google Fonts and have an inline
script on `admin.html`, which this policy blocks.

## Policy

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (no `preload` until the whole domain is ready) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

`connect-src 'self'` works because the frontend calls the API same-origin at `/api` (a CloudFront behaviour to the API
Gateway origin). `style-src 'unsafe-inline'` is still needed: `admin.html`, `stand.html` and `privacy.html` have
inline `<style>` blocks, and the game's screens build markup with about 320 inline `style="…"` attributes. Removing
`'unsafe-inline'` from `style-src` is a larger refactor and is not planned. It is low risk here because `script-src`
stays strict.

`nosniff` needs correct content types. The deploy workflow sets `application/javascript`, `text/css`,
`application/json` and `font/woff2` explicitly.

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

## Removing it (rollback)

If anything breaks after attaching, set `ResponseHeadersPolicyId` back to empty (remove the key) on the same cache
behaviours, using steps 3 and 4 with a fresh `ETag`. It takes effect in about a minute, with no cache invalidation
needed. The policy itself can stay in the account; it costs nothing while detached.

## Readiness audit (Task H, v3 branch)

`script-src 'self'` blocks every inline `<script>` body, every `on*=` attribute and every `javascript:` URL.
`font-src 'self'` and `style-src 'self' 'unsafe-inline'` block third-party fonts and stylesheets.

| Page or area | Finding | Status |
| --- | --- | --- |
| `index.html` | One external module (`js/main.js`). No inline script, no handlers. | Ready |
| `admin.html` | The inline script and its `onclick` handlers moved to `js/admin.js` (module, `addEventListener`). | Ready (Task H) |
| `stand.html` | External `js/stand.js` only. Has an inline `<style>` block (allowed). | Ready |
| `privacy.html` | No script. Inline `<style>` block and two `style=` attributes (allowed). | Ready |
| Fonts | Self-hosted woff2 under `assets/fonts/` via `css/fonts.css` (Task G). No Google Fonts `@import` or `<link>` left. | Ready |
| Markup built by `js/**` | No `on*=` attributes and no `javascript:` URLs. About 320 `style="…"` attributes (allowed by `'unsafe-inline'`). | Ready |
| `eval`, `new Function`, string timers | None. | Ready |
| Network | All API calls go to same-origin `/api`. The only absolute URLs are link targets (hedj.eu, dataprotection.ie). Navigation is not covered by this policy. | Ready |
| Images | Same-origin files and canvas only. `data:` is allowed. | Ready |

`tests/client/csp.test.js` enforces the script rules on every shipped page and on all of `js/**`.
