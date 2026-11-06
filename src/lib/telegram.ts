/** Telegram Bot API 的最小类型定义与客户端封装。只覆盖本项目实际用到的方法。 */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel" | string;
  title?: string;
  username?: string;
  photo?: { small_file_id: string; big_file_id: string };
  linked_chat_id?: number;
}

export interface TgFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  /** 以频道/群组身份发出的消息（匿名频道发言） */
  sender_chat?: TgChat;
  text?: string;
  reply_to_message?: TgMessage;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
  web_app_data?: { data: string; button_text: string };
}

export interface TgChatJoinRequest {
  chat: TgChat;
  from: TgUser;
  user_chat_id: number;
  date: number;
  bio?: string;
}

export interface TgChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked" | string;
  user: TgUser;
  is_member?: boolean;
  until_date?: number;
  can_restrict_members?: boolean;
  can_invite_users?: boolean;
  can_change_info?: boolean;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  chat_join_request?: TgChatJoinRequest;
  chat_member?: TgChatMemberUpdated;
  my_chat_member?: TgChatMemberUpdated;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  web_app?: { url: string };
  callback_data?: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TgEntity {
  type: "text_mention" | "bold" | "italic" | "code";
  offset: number;
  length: number;
  user?: { id: number; first_name?: string; is_bot?: boolean };
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  entities?: TgEntity[];
  parse_mode?: "HTML" | "MarkdownV2";
  disable_web_page_preview?: boolean;
  reply_markup?: InlineKeyboardMarkup;
  message_thread_id?: number;
}

export interface TgMessageId {
  message_id: number;
}

export interface TgChatMemberInfo {
  status: string;
  user: TgUser;
  can_restrict_members?: boolean;
}

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
    readonly parameters?: Record<string, unknown>,
  ) {
    super(`Telegram ${method} 失败 (${code}): ${message}`);
    this.name = "TelegramError";
  }
}

/** 静音权限：拒绝一切发言类权限，但保留"在群里"的状态。 */
export const MUTED_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
} as const;

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly base = "https://api.telegram.org",
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: unknown; error_code?: number; description?: string; parameters?: Record<string, unknown> }
      | null;
    if (!res.ok || !body || body.ok !== true) {
      throw new TelegramError(
        method,
        body?.error_code ?? res.status,
        body?.description ?? `HTTP ${res.status}`,
        body?.parameters,
      );
    }
    return body.result as T;
  }

  /** 非关键调用：失败只记日志，不让整条业务流程崩掉。 */
  async safe<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T | null> {
    try {
      return await this.call<T>(method, params);
    } catch (err) {
      console.warn(`[telegram] ${method} 失败:`, err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** 群信息（标题、头像 file_id）。 */
  getChat(chatId: number | string) {
    return this.call<TgChat>("getChat", { chat_id: chatId });
  }

  /** 下载文件（/file/bot<token>/<path>），返回原始响应。 */
  async downloadFile(filePath: string): Promise<Response> {
    return fetch(`${this.base}/file/bot${this.token}/${filePath}`);
  }

  sendMessage(params: SendMessageParams) {
    return this.call<TgMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  trySendMessage(params: SendMessageParams) {
    return this.safe<TgMessage>("sendMessage", params as unknown as Record<string, unknown>);
  }

  /** 封禁"以频道身份发言"的频道（sender_chat）。 */
  banChatSenderChat(chatId: number, senderChatId: number) {
    return this.safe<boolean>("banChatSenderChat", {
      chat_id: chatId,
      sender_chat_id: senderChatId,
    });
  }

  deleteMessage(chatId: number, messageId: number) {
    return this.safe<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  /** 改一条已发出的消息（顺便清掉按钮）。失败不算错误：消息可能已被删除。 */
  editMessageText(params: { chat_id: number; message_id: number; text: string; parse_mode?: "HTML" }) {
    return this.safe<TgMessage | boolean>("editMessageText", {
      chat_id: params.chat_id,
      message_id: params.message_id,
      text: params.text,
      ...(params.parse_mode ? { parse_mode: params.parse_mode } : {}),
    });
  }

  answerCallbackQuery(id: string, text: string, showAlert = false) {
    return this.safe<boolean>("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
  }

  getChatMember(chatId: number, userId: number) {
    return this.call<TgChatMemberInfo>("getChatMember", { chat_id: chatId, user_id: userId });
  }

  approveChatJoinRequest(chatId: number, userId: number) {
    return this.call<boolean>("approveChatJoinRequest", { chat_id: chatId, user_id: userId });
  }

  declineChatJoinRequest(chatId: number, userId: number) {
    return this.call<boolean>("declineChatJoinRequest", { chat_id: chatId, user_id: userId });
  }

  restrictChatMember(chatId: number, userId: number, untilDate: number) {
    return this.call<boolean>("restrictChatMember", {
      chat_id: chatId,
      user_id: userId,
      permissions: MUTED_PERMISSIONS,
      until_date: untilDate,
    });
  }

  unrestrictChatMember(chatId: number, userId: number) {
    return this.call<boolean>("restrictChatMember", {
      chat_id: chatId,
      user_id: userId,
      permissions: {
        can_send_messages: true,
        can_send_audios: true,
        can_send_documents: true,
        can_send_photos: true,
        can_send_videos: true,
        can_send_video_notes: true,
        can_send_voice_notes: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
    });
  }

  banChatMember(chatId: number, userId: number) {
    return this.call<boolean>("banChatMember", { chat_id: chatId, user_id: userId, revoke_messages: false });
  }

  unbanChatMember(chatId: number, userId: number) {
    return this.call<boolean>("unbanChatMember", { chat_id: chatId, user_id: userId, only_if_banned: true });
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query", "chat_join_request", "chat_member", "my_chat_member"],
      drop_pending_updates: false,
    });
  }

  deleteWebhook() {
    return this.call<boolean>("deleteWebhook", { drop_pending_updates: false });
  }

  getWebhookInfo() {
    return this.call<Record<string, unknown>>("getWebhookInfo");
  }

  getMe() {
    return this.call<{ id: number; username?: string; first_name: string }>("getMe");
  }
}
