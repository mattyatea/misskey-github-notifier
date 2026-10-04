# misskey-github-notifier
GitHub notifier for Misskey

For Type4ny on Cloudflare Workers, use the [Cloudflare deployment instructions](#cloudflare-workers-deployment-for-type4ny) below. The `config.json` instructions immediately below are for the original Node server.

## Configuration
Make a file called `config.json` and put your JSON into it to configure the bot.

### GitHub webhook
1. Go to the settings of your repo -> Webhooks -> Add Webhook
2. For Payload URL, put the URL or IP you'll be hosting the bot on followed by `/github`
3. For content type, select `application/json`
4. Make a random string of characters (~25 chars) and put it under Secret. Put the same string under `hookSecret` in `config.json`.

### Misskey bot
1. Go to a bot-friendly Misskey instance and make a new account. Put the instance URL (including the https:// part) under `instance` in `config.json`. Please mark the account as a bot.
2. On the profile, hit the 3 dots -> Edit Profile 
3. Go to API -> Generate Token
4. Put the token into `i` in `config.json`

### Config schema

``` json
{
	"port": 3000,
	"hookSecret": "",
	"i": "",
	"instance": ""
}
```

## Cloudflare Workers deployment for Type4ny

The dependency-free Worker implementation is in [`cloudflare/`](cloudflare/).
It receives GitHub webhooks at `/github` and posts to Misskey. It replaces the
need to keep the Node server running. The default non-secret settings target
`Type4ny-Project/Misskey` and `https://mattyaski.co`. The existing notifier
account is `@notify@mattyaski.co`; use its API token or change the instance
setting to use another account. The old `Type4ny-Project/Type4ny` repository
is archived.

### Deploy from Cloudflare dashboard

1. Fork this repository to your GitHub account.
2. In Cloudflare **Workers & Pages**, choose **Create application** then
   **Import a repository**, and select the fork.
3. Set the Worker name to `type4ny-github-notifier`, the root directory to
   `cloudflare`, and the deploy command to `npx wrangler deploy`. No build
   command is needed.
4. Add two **runtime Secrets** under **Settings → Variables and Secrets**:
   `MISSKEY_TOKEN` (a Misskey token with permission to create notes) and
   `GITHUB_WEBHOOK_SECRET` (a long random string). These are secrets, not build
   variables. Then deploy the Worker.
5. In the GitHub settings for `Type4ny-Project/Misskey`, check whether an
   active notifier webhook already exists. Add or update one with payload URL
   `https://type4ny-github-notifier.<your-workers-subdomain>.workers.dev/github`,
   content type `application/json`, and the same webhook secret. Select the
   events you want from Pushes, Issues, Issue comments, Pull requests, Pull
   request reviews, Pull request review comments, Releases, Stars, Forks,
   Discussions, Discussion comments, and Commit statuses.

The Worker responds at `/health`. Push notifications are limited to `develop`.
To change the target repository, branch, or Misskey server, edit the ordinary
variables in `cloudflare/wrangler.jsonc`. Signature verification uses GitHub's
`X-Hub-Signature-256` header and the original request bytes. Secrets are never
stored in Git.

### Deploy with Wrangler instead

From `cloudflare/`, run `npm install` with Node.js 22 or newer, authenticate
with `npx wrangler login`, then deploy with a local `.env.production` file
containing both secret names above using
`npx wrangler deploy --secrets-file .env.production`. That file is Git-ignored.
