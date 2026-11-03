# Optional authenticated dev proxy

Localhost is the default. To edit from another device through a local Tailscale
Serve proxy, set `trustedProxyUser` to the exact authenticated login, preferably
from an environment variable. The proxy must overwrite `Tailscale-User-Login`
with the verified identity and forward Host. Never use this with a proxy that
passes an untrusted client-supplied identity header through unchanged.

The editor accepts that user only over a loopback upstream connection; browser
Origin must be HTTPS and match the forwarded Host. Other remote users and
foreign origins are refused. This option is config-only and is not exposed by
the settings UI. Astro's allowedHosts must allow the dev hostname separately.

This remains a development server, not a production editing endpoint.
