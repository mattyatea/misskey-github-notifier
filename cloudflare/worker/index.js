// Event messages adapted from syuilo/misskey-github-notifier (MIT).
const encoder = new TextEncoder();

function signatureBytes(header) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(header || "")) return null;
  const hex = header.slice(7);
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

async function validSignature(body, header, secret) {
  const signature = signatureBytes(header);
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, body);
}

function firstLine(value) {
  return String(value || "").split("\n", 1)[0];
}

function renderEvent(event, data, branch) {
  switch (event) {
    case "push": {
      if (data.deleted || data.ref !== `refs/heads/${branch}`) return null;
      const commits = data.commits || [];
      const visible = commits.slice(-10).reverse();
      const lines = visible.map((commit) =>
        `・[?[${commit.id.slice(0, 7)}](${commit.url})] ${firstLine(commit.message)}`,
      );
      if (commits.length > visible.length) lines.push(`ほか ${commits.length - visible.length} 件`);
      return {
        text: [
          `🆕 Pushed by **${data.pusher?.name || data.sender?.login || "unknown"}** with ?[${commits.length} commit${commits.length === 1 ? "" : "s"}](${data.compare}):`,
          ...lines,
        ].join("\n"),
      };
    }
    case "issues": {
      const titles = { opened: "💥 Issue opened", closed: "💮 Issue closed", reopened: "🔥 Issue reopened" };
      const title = titles[data.action];
      return title && data.issue ? { text: `${title}: #${data.issue.number} "${data.issue.title}"\n${data.issue.html_url}` } : null;
    }
    case "issue_comment":
      return data.action === "created" && data.comment
        ? { text: `💬 Commented on "${data.issue.title}": ${data.sender.login} "<plain>${data.comment.body || ""}</plain>"\n${data.comment.html_url}` }
        : null;
    case "release":
      return data.action === "published" && data.release
        ? { text: `🎁 **NEW RELEASE**: [${data.release.tag_name}](${data.release.html_url}) is out. Enjoy!` }
        : null;
    case "watch":
      return data.action === "started" && data.sender
        ? { text: `$[spin ⭐️] Starred by ?[**${data.sender.login}**](${data.sender.html_url})`, visibility: "public" }
        : null;
    case "fork":
      return data.forkee && data.sender
        ? { text: `$[spin.y 🍴] ?[Forked](${data.forkee.html_url}) by ?[**${data.sender.login}**](${data.sender.html_url})` }
        : null;
    case "pull_request": {
      const pr = data.pull_request;
      if (!pr) return null;
      const titles = {
        opened: "📦 New Pull Request",
        reopened: "🗿 Pull Request Reopened",
        ready_for_review: "👀 Pull Request marked as ready",
      };
      const title = data.action === "closed"
        ? (pr.merged ? "💯 Pull Request Merged!" : "🚫 Pull Request Closed")
        : titles[data.action];
      return title ? { text: `${title}: "${pr.title}"\n${pr.html_url}` } : null;
    }
    case "pull_request_review_comment":
      return data.action === "created" && data.comment
        ? { text: `💬 Review commented on "${data.pull_request.title}": ${data.sender.login} "<plain>${data.comment.body || ""}</plain>"\n${data.comment.html_url}` }
        : null;
    case "pull_request_review":
      return data.action === "submitted" && data.review?.body
        ? { text: `👀 Review submitted: "${data.pull_request.title}": ${data.sender.login} "<plain>${data.review.body}</plain>"\n${data.review.html_url}` }
        : null;
    case "discussion": {
      const titles = {
        created: "💭 Discussion opened",
        closed: "💮 Discussion closed",
        reopened: "🔥 Discussion reopened",
        answered: "✅ Discussion marked answer",
        unanswered: "🔥 Discussion unmarked answer",
      };
      const title = titles[data.action];
      const url = data.action === "answered" ? data.answer?.html_url : data.discussion?.html_url;
      return title && data.discussion && url
        ? { text: `${title}: #${data.discussion.number} "${data.discussion.title}"\n${url}` }
        : null;
    }
    case "discussion_comment":
      return data.action === "created" && data.comment
        ? { text: `💬 Commented on "${data.discussion.title}": ${data.sender.login} "<plain>${data.comment.body || ""}</plain>"\n${data.comment.html_url}` }
        : null;
    case "status":
      return ["error", "failure"].includes(data.state) && data.commit
        ? { text: `🚨 **BUILD FAILED** 🚨: ?[${firstLine(data.commit.commit?.message)}](${data.commit.html_url})` }
        : null;
    default:
      return null;
  }
}

async function postNote(env, note) {
  const instance = new URL(env.MISSKEY_INSTANCE);
  if (instance.protocol !== "https:") throw new Error("MISSKEY_INSTANCE must use HTTPS");
  const endpoint = new URL("/api/notes/create", instance);
  const text = note.text.length > 2999 ? `${note.text.slice(0, 2998)}…` : note.text;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      i: env.MISSKEY_TOKEN,
      text,
      visibility: note.visibility || "home",
      noExtractMentions: true,
      noExtractHashtags: true,
    }),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Misskey returned HTTP ${response.status}`);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (path !== "/github") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.MISSKEY_INSTANCE || !env.MISSKEY_TOKEN || !env.GITHUB_WEBHOOK_SECRET || !env.GITHUB_REPOSITORY) {
      console.error("Required Worker configuration is missing");
      return new Response("Server configuration is incomplete", { status: 500 });
    }

    const body = await request.arrayBuffer();
    if (!await validSignature(body, request.headers.get("x-hub-signature-256"), env.GITHUB_WEBHOOK_SECRET)) {
      return new Response("Invalid signature", { status: 401 });
    }

    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (data.repository?.full_name !== env.GITHUB_REPOSITORY) {
      return new Response("Repository ignored", { status: 202 });
    }

    const note = renderEvent(request.headers.get("x-github-event"), data, env.PUSH_BRANCH || "develop");
    if (!note) return new Response(null, { status: 204 });
    try {
      await postNote(env, note);
      return new Response(null, { status: 204 });
    } catch (error) {
      console.error("Failed to post GitHub event to Misskey", error);
      return new Response("Misskey post failed", { status: 502 });
    }
  },
};
