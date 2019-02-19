import * as config from 'config';
import {NextFunction, Response} from 'express';
import {IBotRequest} from '../../botApi';
import debugFactory from '../../helpers/debug';
import {translate} from '../../helpers/dictionary';
import Menu, {Row} from '../../helpers/menu';
import {IAnek, ISuggest, IUser} from "../../helpers/mongo";

import Telegram, {
  AllMessageParams,
  CallbackQuery,
  ChatAction,
  InlineKeyboardButton,
  InlineQuery, InputMediaPhoto, MediaGroup,
  Message,
  MessageParams, OtherParams,
  PreCheckoutQuery,
  SuccessfulPayment,
  Update,
  User
} from '../telegram';
import {Anek, Attachment as VkAttachment, Comment, PollAnswer} from '../vk';

type SuggestMessage = {
  caption: string,
  chat_id: number,
  text: string,
  photo?: string,
  video?: string,
  audio?: string,
  video_note?: string,
  document?: string,
  voice?: string,
  reply_markup?: string
};

const debug = debugFactory('baneks-node:bot');

interface Bot extends Telegram {
  on(event: string, callback: (...params: any) => void | Promise<void>): void | Promise<void>;
  on(event: 'message' | 'feedback', callback: (message: Message, user: IUser) => void): void | Promise<void>;
  on(event: 'callbackQuery', callback: (callbackQuery: CallbackQuery, user: IUser) => void): void | Promise<void>;
  on(event: 'inlineQuery', callback: (inlineQuery: InlineQuery, user: IUser) => void): void | Promise<void>;
  on(event: 'preCheckoutQuery', callback: (preCheckoutQuery: PreCheckoutQuery, user: IUser) => void): void | Promise<void>;
  on(event: 'successfulPayment', callback: (successfulPayment: SuccessfulPayment, user: IUser) => void): void | Promise<void>;
  on(event: 'newChatMembers', callback: (members: User[], message: Message, user: IUser) => void): void | Promise<void>;
  on(event: 'leftChatMember', callback: (member: User, message: Message, user: IUser) => void): void | Promise<void>;
  on(event: 'suggest', callback: (suggest: Message, user: IUser) => void): void | Promise<void>;
  on(event: 'reply', callback: (reply: Message, message: Message, user: IUser) => void): void | Promise<void>;
}

class Bot extends Telegram {
  private buttons: string[] = [];

  public onCommand(command: string, callback: (command: string[], message: Message, user: IUser) => any | Promise<any>) {
    return this.on('command:' + command, callback);
  }

  public onButton(button: string, callback: (message: Message, user: IUser) => any | Promise<any>) {
    if (this.buttons.indexOf(button) <= 0) {
      this.buttons.push(button);
    }

    return this.on('button:' + button, callback);
  }

  public getUserInfo(user: IUser): string {
    if (!user || !user.user_id) {
      return 'Invalid user';
    }

    if (user.username) {
      return '@' + user.username;
    }

    if (user.first_name && user.last_name) {
      return user.first_name + ' ' + user.last_name + ' (' + user.user_id + ')';
    } else if (user.first_name) {
      return user.first_name + ' (' + user.user_id + ')';
    } else if (user.last_name) {
      return user.last_name + ' (' + user.user_id + ')';
    }

    if (user.title) {
      return user.title;
    }

    return String(user.user_id);
  }

  public convertTextLinks(text: string = '') {
    const userRegexp = /\[(.+)\|(.+)]/g;

    return text.replace(userRegexp, (match, p1, p2) => `[${p2}](https://vk.com/${p1})`);
  }

  public async sendMessageWithChatAction(
    userId: number | string,
    chatAction: ChatAction,
    message: string,
    params?: AllMessageParams
  ): Promise<Message> {
    this.sendChatAction(userId, chatAction);

    return this.sendMessage(userId, message, params);
  }

  public async sendAttachment(userId: number | string, attachment: VkAttachment, params?: AllMessageParams): Promise<Message> {
    switch (attachment.type) {
      case 'photo':
        const photo = attachment.photo.photo_2560
            || attachment.photo.photo_1280
            || attachment.photo.photo_604
            || attachment.photo.photo_130
            || attachment.photo.photo_75;

        return this.sendPhoto(userId, photo, {caption: attachment.text, ...params});
      case 'video':
        const caption = (attachment.title || '') + '\nhttps://vk.com/video' + attachment.video.owner_id + '_' + attachment.video.id;
        const video = attachment.video.photo_800
            || attachment.video.photo_640
            || attachment.video.photo_320
            || attachment.video.photo_130;

        return this.sendPhoto(userId, video, {caption, ...params});
      case 'doc':
        const document = attachment.doc.url;

        return this.sendDocument(userId, document, {caption: attachment.doc.title, ...params});
      case 'audio':
        const audio = attachment.audio.url;

        return this.sendAudio(userId, audio, {title: attachment.audio.title, performer: attachment.audio.artist, ...params});
      case 'poll':
        const poll = 'Опрос: *' + attachment.poll.question + '*\n' + (attachment.poll.answers || [])
            .map((answer: PollAnswer, index: number) => (index + 1) + ') ' + answer.text + ': ' + answer.votes + ' голоса (' + answer.rate + '%)')
            .join('\n');

        return this.sendMessageWithChatAction(userId, ChatAction.typing, poll, params);
      case 'link':
        const link = attachment.link.title + '\n' + attachment.link.url;

        return this.sendMessageWithChatAction(userId, ChatAction.typing, link, params);
    }
  }

  public async sendAttachments(userId: number | string, attachments: VkAttachment[] = [], params?: AllMessageParams): Promise<Message | Message[]> {
    const mediaGroup: MediaGroup = attachments
        .filter((attachment: VkAttachment) => attachment.type === 'photo')
        .map((attachment: VkAttachment): InputMediaPhoto => ({
          caption: attachment.text,
          media: attachment.photo.photo_2560
              || attachment.photo.photo_1280
              || attachment.photo.photo_604
              || attachment.photo.photo_130
              || attachment.photo.photo_75,
          type: 'photo'
        }));

    if (mediaGroup.length === attachments.length && (mediaGroup.length >= 2 && mediaGroup.length <= 10)) {
      return this.sendMediaGroup(userId, mediaGroup, params);
    }

    return this.fulfillAll(attachments
        .filter(Boolean)
        .map((attachment: VkAttachment) => this.sendAttachment(userId, attachment, params)));
  }

  public createApproveButtons(postId: number, pros: number = 0, cons: number = 0): InlineKeyboardButton[] {
    return new Row()
      .addButton(`👍 ${pros}`, `a_a ${postId}`)
      .addButton(`👎 ${cons}`, `a_d ${postId}`);
  }

  public getAnekButtons(anek: IAnek, params: OtherParams = {}): InlineKeyboardButton[][] {
    const buttons: Menu = new Menu();

    const {disableComments, language, forceAttachments, admin, editor, disableAttachments} = params;

    if (anek.from_id && anek.post_id) {
      const commentsRow = buttons.addRow();

      commentsRow.addButton(translate(language, 'go_to_anek'), {url: `https://vk.com/wall${anek.from_id}_${anek.post_id}`});

      if (!disableComments) {
        commentsRow.addButton(translate(language, 'comments'), `comment ${anek.post_id}`);
      }
    }

    if (anek.attachments && anek.attachments.length > 0 && !forceAttachments && !disableAttachments) {
      buttons.addRow()
        .addButton(translate(language, 'attachments'), `attach ${anek.post_id}`);
    }

    if (anek.post_id) {
      if (admin || editor) {
        const adminButtons = buttons.addRow();

        if (anek.spam) {
          adminButtons.addButton('✅', `unspam ${anek.post_id}`);
        } else {
          adminButtons.addButton('🚫', `spam ${anek.post_id}`);
        }

        adminButtons.addButton('🔍', `analysis ${anek.post_id}`);
      }
    }

    return buttons;
  }

  public async sendAnek(userId: number | string, anek: IAnek, params: AllMessageParams = {}): Promise<Message | Message[]> {
    if (!anek) {
      return;
    }

    const buttons: InlineKeyboardButton[][] = this.getAnekButtons(anek, params);
    const replyMarkup: string = this.prepareReplyMarkup(this.prepareInlineKeyboard(buttons));
    let text: string = anek.text;

    if (anek.attachments && anek.attachments.length > 0 && !params.forceAttachments && !params.disableAttachments) {
      text += '\n(Вложений: ' + anek.attachments.length + ')';
    }

    return this.sendMessage(userId, this.convertTextLinks(text), {
      reply_markup: replyMarkup,
      ...params
    })
      .then((message: Message) => {
        if (anek.attachments && params.forceAttachments) {
          return this.sendAttachments(userId, anek.attachments, {
            forcePlaceholder: !anek.text,
            reply_markup: replyMarkup,
            reply_to_message_id: message && message.message_id,
            ...params
          });
        }

        return message;
      });
  }

  public sendComment(userId: number, comment: Comment, params: MessageParams) {
    return this.sendMessage(userId, this.convertTextLinks(comment.text), params)
      .then((message: any) => {
        if (comment.attachments && comment.attachments.length) {
          return this.sendAttachments(userId, comment.attachments, {forceAttachments: true});
        }

        return message;
      });
  }

  public sendComments(userId: number, comments: Comment[] = [], params: AllMessageParams) {
    return this.fulfillAll(comments.map((comment) => this.sendComment(userId, comment, params)));
  }

  public sendSuggest(userId: number, suggest: ISuggest, params: AllMessageParams) {
    const buttons: Menu = new Menu();

    const sendMessage: SuggestMessage = {
      caption: suggest.caption,
      chat_id: userId,
      text: suggest.text
    };
    let commandType = '';

    if (params.native) {
      let chatId = userId;

      if (suggest && suggest.chat && suggest.chat.id) {
        chatId = suggest.chat.id;
      }

      return this.forwardMessage(userId, suggest.message_id, chatId);
    }

    if (params.suggest) {
      const suggestRow = buttons.addRow();

      if (params.editor) {
        if (suggest.public) {
          suggestRow.addButton('+', 's_a ' + suggest._id);
        }

        suggestRow.addButton('Анон', 's_aa ' + suggest._id);
        suggestRow.addButton('-', 's_d ' + suggest._id);
      } else {
        suggestRow.addButton('Удалить', 's_d ' + suggest._id);
      }
    }

    if (buttons.length) {
      sendMessage.reply_markup = this.prepareReplyMarkup(this.prepareInlineKeyboard(buttons));
    }

    if (suggest.audio && suggest.audio.file_id) {
      commandType = 'sendAudio';
      sendMessage.audio = suggest.audio.file_id;
    } else if (suggest.voice && suggest.voice.file_id) {
      commandType = 'sendVoice';
      sendMessage.voice = suggest.voice.file_id;
    } else if (suggest.video_note && suggest.video_note.file_id) {
      commandType = 'sendVideoNote';
      sendMessage.video_note = suggest.video_note.file_id;
    } else if (suggest.document && suggest.document.file_id) {
      commandType = 'sendDocument';
      sendMessage.document = suggest.document.file_id;
    } else if (suggest.photo && suggest.photo.length > 0) {
      commandType = 'sendPhoto';
      sendMessage.photo = suggest.photo[suggest.photo.length - 1].file_id;
    } else {
      commandType = 'sendMessage';
      sendMessage.text = sendMessage.text || 'Пустое сообщение';
    }

    return this.sendRequest(commandType, sendMessage);
  }

  public sendSuggests(userId: number, suggests: ISuggest[], params: AllMessageParams) {
    return this.fulfillAll(suggests.map((suggest: ISuggest) => this.sendSuggest(userId, suggest, params)));
  }

  public async sendMediaGroup(userId: number | string, mediaGroup: MediaGroup = [], params?: AllMessageParams): Promise<Message> {
    if (params.forcePlaceholder) {
      await this.sendMessage(userId, 'Вложений: ' + mediaGroup.length, params);
    }

    this.sendChatAction(userId, ChatAction.uploadPhoto);

    return super.sendMediaGroup(userId, mediaGroup, params);
  }

  public forwardMessageToChannel(message: ISuggest, params: AllMessageParams) {
    if (!config.get('telegram.baneksChannel')) {
      return;
    }
    return this.sendSuggest(config.get('telegram.baneksChannel'), message, params);
  }

  public sendMessageToAdmin(text: string) {
    return this.sendMessage(config.get('telegram.adminChat'), text);
  }

  public isSameChat(message: Message): boolean {
    return message && message.chat && message.from && message.chat.id === message.from.id;
  }

  public performInlineQuery(inlineQuery: InlineQuery, user: IUser) {
    debug('Performing inline query from ' + this.getUserInfo(user));
    return this.emit('inlineQuery', inlineQuery, user);
  }

  public performCallbackQuery(callbackQuery: CallbackQuery, user: IUser) {
    debug('Performing callback query from ' + this.getUserInfo(user));
    return this.emit('callbackQuery', callbackQuery, user);
  }

  public performMessage(message: Message, user: IUser) {
    debug('Performing message from ' + this.getUserInfo(user));
    return this.emit('message', message, user);
  }

  public performCommand(command: string[], message: Message, user: IUser) {
    debug('Performing command from ' + this.getUserInfo(user));
    return this.emit('command:' + command[0].slice(1), command, message, user);
  }

  public performPreCheckoutQuery(preCheckoutQuery: PreCheckoutQuery, user: IUser) {
    debug('Performing pre checkout query from ' + this.getUserInfo(user));
    return this.emit('preCheckoutQuery', preCheckoutQuery, user);
  }

  public performSuccessfulPayment(successfulPayment: SuccessfulPayment, user: IUser) {
    debug('Performing successful payment from ' + this.getUserInfo(user));
    return this.emit('successfulPayment', successfulPayment, user);
  }

  public performNewChatMembers(members: User[], message: Message, user: IUser) {
    return this.emit('newChatMembers', members, message, user);
  }

  public performLeftChatMember(member: User, message: Message, user: IUser) {
    return this.emit('leftChatMember', member, message, user);
  }

  public performSuggest(suggest: Message, user: IUser) {
    return this.emit('suggest', suggest, user);
  }

  public performReply(reply: Message, message: Message, user: IUser) {
    return this.emit('reply', reply, message, user);
  }

  public performFeedback(message: Message, user: IUser) {
    return this.emit('feedback', message, user);
  }

  public performButton(button: string, message: Message, user: IUser) {
    debug('Performing button ' + button + ' from ' + this.getUserInfo(user));
    return this.emit('button:' + button, message, user);
  }

  public performUpdate(update: Update, user: IUser) {
    if (!update) {
      throw new Error('No webhook data specified');
    }

    const {message} = update;

    if (message) {
      if (message.successful_payment) {
        return this.performSuccessfulPayment(message.successful_payment, user);
      }

      if (message.new_chat_members) {
        return this.performNewChatMembers(message.new_chat_members, message, user);
      }

      if (message.left_chat_member) {
        return this.performLeftChatMember(message.left_chat_member, message, user);
      }

      if (user.suggest_mode && !user.banned) {
        return this.performSuggest(message, user);
      }

      if (message.reply_to_message) {
        return this.performReply(message.reply_to_message, message, user);
      }

      if (message.text) {
        const {text} = message;

        if (text && text.startsWith('/')) {
          const command = text.split(' ');
          const firstPart = command[0];

          if (firstPart) {
            const botName = firstPart.split('@');

            if (botName.length === 1 || (botName.length === 2 && botName[1] === config.get('telegram.botName'))) {
              return this.performCommand([botName[0], ...command.slice(1)], update.message, user);
            }
          }
        }

        if (message.text.length > 0) {
          const button = message.text.slice(0, 2);

          if (this.buttons.indexOf(button) >= 0) {
            return this.performButton(button, message, user);
          }
        }

        if (user.feedback_mode && !user.banned && this.isSameChat(message)) {
          return this.performFeedback(message, user);
        }

        return this.performMessage(update.message, user);
      }

      throw new Error('Unknown message');
    }

    if (update.inline_query) {
      return this.performInlineQuery(update.inline_query, user);
    }

    if (update.callback_query) {
      return this.performCallbackQuery(update.callback_query, user);
    }

    if (update.pre_checkout_query) {
      return this.performPreCheckoutQuery(update.pre_checkout_query, user);
    }

    return Promise.resolve([]);
  }

  public middleware = (req: IBotRequest, res: Response, next: NextFunction) => {
    const update = req.body;

    if (!update) {
      next(new Error('No webhook data specified'));

      return;
    }

    const {user} = req;

    this.emit('update', update, user);

    req.update = update;

    this.performUpdate(update, user)
      .then((results) => {
        req.results = results;

        next();
      })
      .catch(next);
  }
}

export default Bot;
