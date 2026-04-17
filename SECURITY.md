# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 2.2.x | ✅ Yes |
| < 2.2 | ❌ No |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email the maintainer directly via LinkedIn:
https://www.linkedin.com/in/joon-nyip-koh-6a219234/

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

You will receive a response within 48 hours.

## API Key Safety

- Never commit your `.env` file
- Never share API keys in issues or pull requests
- The `.gitignore` excludes `.env` by default — keep it that way
- Rotate any key you accidentally expose immediately

## Simulation Mode

`SIMULATE_TRADES=true` (the default) means no real funds are at risk.
Always verify this is set before running the application.
