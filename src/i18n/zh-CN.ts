/** 机器人文案（中文）。{name} 是占位符。 */
export default {
  "dm.prompt.head": "Hello <b>{name}</b>，你正在申请加入群组「<b>{chat}</b>」",
  "dm.prompt.why": "在进群之前，我们要确认你不是机器人或者恶意用户",
  "dm.prompt.ttl": "本次验证将在 {duration} 内有效，如需重新发起验证，请尝试重新加入群组",
  "dm.prompt.remaining": "今日剩余尝试次数：{count} 次",
  "dm.prompt.cta": "从下方的按钮中选择一个合适的验证方式吧",

  "dm.approved": "验证通过，欢迎进入群「{chat}」",
  "dm.rejected": "验证失败，{reason}\n群：{chat}",
  "dm.timeout": "验证超时，「{chat}」的入群申请已经被取消，请重试",
  "dm.blocked": "验证失败：（{reason}），请联系管理员",
  "dm.rateLimited": "今日尝试次数过多，请明天重试",

  "group.notice": "欢迎 <a href=\"tg://user?id={uid}\">{name}</a> 入群，请先验证你的身份",
  "group.notice.button": "开始验证",

  "cmd.header": "<b>命令列表</b>",
  "cmd.start": "/start：开始或继续验证",
  "cmd.id": "/id：查看当前 id",
  "cmd.pass": "/pass &lt;uid&gt;：回复消息或提供 id 以通过入群验证",
  "cmd.ban": "/ban &lt;uid&gt;：回复消息活提供 id 以封禁用户",
  "cmd.pending": "/pending：查看当前等待验证的会话数",
  "cmd.audit": "/audit [n]：显示最近 n 条操作记录",

  "chat.askName": "请发送你的 Github 用户名",
  "chat.signCommand": "你好 <code>{username}</code>！\n为了证明你的身份，请通过已经在 Github 添加过的密钥对的私钥签名。请在终端运行：\n<pre>{command}</pre>\n并提供 <code>-----BEGIN SSH SIGNATURE-----</code> 到 <code>-----END SSH SIGNATURE-----</code> 结尾的一整段签名",
  "chat.noPending": "当前没有待处理的入群申请",
  "chat.badUsername": "无法识别的用户名，请重试",
  "chat.needSignature": "正在等待签名，请提供 <code>-----BEGIN SSH SIGNATURE-----</code> 到 <code>-----END SSH SIGNATURE-----</code> 结尾的一整段签名",
  "chat.expired": "入群申请已过期，请尝试重新加入",
  "chat.failed": "无法验证：{error}\n请重试",
  "chat.alreadyHandled": "此入群申请已处理完毕，请返回群组查看状态",
  "chat.unknownSignature": "未知签名",
};
