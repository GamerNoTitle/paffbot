/** 机器人文案（中文）。{name} 是占位符。 */
export default {
  "dm.prompt.head": "<b>{name}</b>，你申请加入「<b>{chat}</b>」。",
  "dm.prompt.why": "进群前先验证一下，防止机器人批量拉人。",
  "dm.prompt.ttl": "⏳ {duration} 内有效，过期就得重新申请。",
  "dm.prompt.remaining": "今天还能试 {count} 次。",
  "dm.prompt.cta": "点下面的按钮就能开始。",

  "dm.approved": "✅ 搞定，已经放你进「{chat}」了。",
  "dm.rejected": "❌ 没通过：{reason}\n群：{chat}",
  "dm.timeout": "⌛️ 超时了，你在「{chat}」的申请已经取消。想进的话重新申请一次。",
  "dm.blocked": "🚫 你的申请被自动拦下了（{reason}）。有疑问找群管理员。",
  "dm.rateLimited": "今天在这个群尝试的太多了，明天再来吧！",

  "group.notice": "<a href=\"tg://user?id={uid}\">{name}</a> 进群了，现在是禁言状态。",
  "group.notice.how": "让 ta 在 {duration} 内私聊 {bot} 发一句 /start 完成验证。",
  "group.notice.why": "（Telegram 不让机器人主动找没说过话的人，所以要 ta 先发一句。）",

  "cmd.header": "<b>命令</b>",
  "cmd.start": "/start：开始或继续验证",
  "cmd.verify": "/verify 用户名：Mini App 打不开时用聊天验证",
  "cmd.id": "/id：看自己的 id",
  "cmd.pass": "/pass &lt;uid&gt;：放人进来（也可以回复对方消息）",
  "cmd.ban": "/ban &lt;uid&gt;：封了并踢出去",
  "cmd.pending": "/pending：还有几个人在等验证",
  "cmd.audit": "/audit [n]：最近 n 条操作记录",

  "chat.askName": "先把你的 <b>GitHub 用户名</b>发给我，不用带 @（比如 <code>octocat</code>）。",
  "chat.signCommand": "好，GitHub 用户名记下了：<code>{username}</code>\n在终端跑这条命令：\n<pre>{command}</pre>\n跑完把 <code>-----BEGIN SSH SIGNATURE-----</code> 开头的那一整段复制发给我。",
  "chat.noPending": "你现在没有待处理的入群申请。先去群里点「申请加入」，再回来找我。",
  "chat.badUsername": "这个用户名看着不太对，再发一次（不用带 @，比如 <code>octocat</code>）。",
  "chat.needSignature": "现在就等你的签名了，把 <code>-----BEGIN SSH SIGNATURE-----</code> 开头的那一整段发给我。",
  "chat.expired": "这条申请已经过期了，回群里重新点一次「申请加入」吧。",
  "chat.failed": "没通过：{error}\n你可以再发一次签名。",
  "chat.alreadyHandled": "这条申请已经处理完了，回群里看看状态吧。",
  "chat.unknownSignature": "我不知道这段签名对应哪次申请。先点「通过聊天验证」，或者发 <code>/verify 用户名</code>。",
  "chat.dmOnly": "聊天验证要在私聊里做。",
  "chat.openDm": "打开私聊",
};
