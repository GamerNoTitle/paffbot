/** Bot copy (English). Same keys as zh-CN.ts. */
export default {
  "dm.prompt.head": "Hi <b>{name}</b>, you asked to join “<b>{chat}</b>”.",
  "dm.prompt.why": "Before you come in, we check that you are not a bot or a spam account.",
  "dm.prompt.ttl": "This check is valid for {duration}. If it expires, ask to join again.",
  "dm.prompt.remaining": "Tries left today: {count}.",
  "dm.prompt.cta": "Pick a method below.",

  "dm.approved": "Verified. Welcome to “{chat}”.",
  "dm.rejected": "Could not verify: {reason}\nGroup: {chat}",
  "dm.timeout": "The check timed out, so your request to join “{chat}” was cancelled. You can ask again.",
  "dm.blocked": "Verification failed ({reason}). Ask a group admin if you think that is wrong.",
  "dm.rateLimited": "Too many tries today. Try again tomorrow.",

  "group.notice": "Welcome <a href=\"tg://user?id={uid}\">{name}</a>. Please verify before you post.",
  "group.notice.button": "Verify",

  "admin.approve": "Approve",
  "admin.reject": "Reject",
  "admin.ban": "Ban",
  "admin.notice": "{name} asked to join “{chat}”. An admin can handle it here.",
  "admin.done.approve": "Approved",
  "admin.done.reject": "Rejected",
  "admin.done.ban": "Banned",

  "cmd.header": "<b>Commands</b>",
  "cmd.start": "/start: start or continue verification",
  "cmd.id": "/id: show the chat id and your id",
  "cmd.pass": "/pass &lt;uid&gt;: approve one request, by replying to it or passing the user id",
  "cmd.ban": "/ban &lt;uid&gt;: ban one user, by replying to their message or passing the id",
  "cmd.pending": "/pending: how many people are waiting",
  "cmd.audit": "/audit [n]: the last n actions",

  "chat.askName": "Send me your GitHub username.",
  "chat.signCommand": "Hi <code>{username}</code>. To prove the account is yours, sign with a private key that matches one of your GitHub keys. Run this in your terminal:\n<pre>{command}</pre>\nThen send me everything from <code>-----BEGIN SSH SIGNATURE-----</code> to <code>-----END SSH SIGNATURE-----</code>.",
  "chat.noPending": "You have no join request waiting. Tap Join in the group first, then come back.",
  "chat.badUsername": "That username does not look right. Send it again.",
  "chat.needSignature": "Waiting for the signature. Send everything from <code>-----BEGIN SSH SIGNATURE-----</code> to <code>-----END SSH SIGNATURE-----</code>.",
  "chat.expired": "That request expired. Ask to join again in the group.",
  "chat.failed": "Could not verify: {error}\nTry again.",
  "chat.alreadyHandled": "That request is already handled. Check the group.",
  "chat.unknownSignature": "Unknown signature."
};
