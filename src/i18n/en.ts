export default {
  "dm.prompt.head": "Hi <b>{name}</b>, you asked to join <b>{chat}</b>.",
  "dm.prompt.why": "One quick check before you come in, so bots cannot mass-join.",
  "dm.prompt.ttl": "⏳ Valid for {duration}. After that you need a new request.",
  "dm.prompt.remaining": "{count} tries left today.",
  "dm.prompt.cta": "Tap the button below to start.",

  "dm.approved": "✅ Done, you are in {chat}.",
  "dm.rejected": "❌ Did not pass: {reason}\nGroup: {chat}",
  "dm.timeout": "⌛️ Timed out. Your request to join {chat} was cancelled. Ask again if you still want in.",
  "dm.blocked": "🚫 Your request was blocked automatically ({reason}). Ask a group admin if you think that is wrong.",
  "dm.rateLimited": "Too many tries in this group today. Come back tomorrow.",

  "group.notice": "<a href=\"tg://user?id={uid}\">{name}</a> just joined and is muted.",
  "group.notice.button": "Verify now",

  "cmd.header": "<b>Commands</b>",
  "cmd.start": "/start: begin or resume",
  "cmd.id": "/id: show your id",
  "cmd.pass": "/pass &lt;uid&gt;: let someone in (or reply to their message)",
  "cmd.ban": "/ban &lt;uid&gt;: ban and remove",
  "cmd.pending": "/pending: how many are waiting",
  "cmd.audit": "/audit [n]: last n actions",

  "chat.askName": "Send me your <b>GitHub username</b> first, without the @ (e.g. <code>octocat</code>).",
  "chat.signCommand": "Got it: <code>{username}</code>\nRun this in your terminal:\n<pre>{command}</pre>\nThen send me the whole block that starts with <code>-----BEGIN SSH SIGNATURE-----</code>.",
  "chat.noPending": "You have no pending request. Tap Join in the group first, then come back.",
  "chat.badUsername": "That does not look like a username. Send it again without the @ (e.g. <code>octocat</code>).",
  "chat.needSignature": "Waiting for the signature. Send the whole block that starts with <code>-----BEGIN SSH SIGNATURE-----</code>.",
  "chat.expired": "That request expired. Tap Join again in the group.",
  "chat.failed": "Did not pass: {error}\nYou can send the signature again.",
  "chat.alreadyHandled": "That request was already handled. Check the group.",
  "chat.unknownSignature": "I cannot tell which request this signature belongs to. Tap the chat check button, or send <code>/verify username</code>.",
};
