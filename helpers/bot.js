/**
 * Created by Александр on 16.04.2016.
 */

module.exports = function (configs) {
    var botConfig = configs.bot,
        requestHelper = require('./request')(configs),
        dict = require('./dictionary'),
        Queue = require('promise-queue'),
        q = require('q'),
        botMethods = {
            sendRequest: function (request, params, method) {
                var botUrl = botConfig.url + botConfig.token + '/' + request,
                    parameters = requestHelper.prepareConfig(botUrl, method);

                return requestHelper.makeRequest(parameters, params);
            },
            sendInline: function (inlineId, results, next_offset) {
                return this.sendRequest('answerInlineQuery', {
                    inline_query_id: inlineId,
                    results: JSON.stringify(results),
                    next_offset: next_offset || 0,
                    cache_time: 0
                })
            },
            answerCallbackQuery: function (queryId, load) {
                if (!load) {
                    load = {};
                }
                return this.sendRequest('answerCallbackQuery', {
                    callback_query_id: queryId,
                    text: load.text,
                    show_alert: load.show_alert,
                    url: load.url
                });
            },
            sendChatAction: function (userId, action) {
                return this.sendRequest('sendChatAction', {
                    chat_id: userId,
                    action: action
                });
            },
            sendAttachment: function (userId, attachment) {
                attachment = this.performAttachment(attachment);

                if (!attachment.command) {
                    throw new Error('Attachment type is undefined');
                }
                var sendCommand = attachment.command;
                delete attachment.command;

                attachment.chat_id = userId;
                return this.sendChatAction(userId, attachment.sendAction)
                    .then(function () {
                        if (attachment.useStream) {
                            var parameters = requestHelper.prepareConfig(attachment[attachment.type], 'GET');

                            console.log('sending stream', attachment[attachment.type]);

                            return requestHelper.makeRequest(parameters, {}, attachment.useStream).then(function (stream) {
                                var botUrl = botConfig.url + botConfig.token + '/' + sendCommand,
                                    parameters = requestHelper.prepareConfig(botUrl, 'POST');

                                attachment[attachment.type] = stream;
                                delete attachment.useStream;
                                return requestHelper.makeRequest(parameters, attachment);
                            });
                        }
                        return this.sendRequest(sendCommand, attachment);
                    }.bind(this));
            },
            prepareButtons: function (message, language) {
                var buttons = [];

                if (!message.disableButtons) {
                    if (!buttons.length) {
                        buttons.push([]);
                    }
                    buttons[buttons.length - 1].push({
                        text: dict.translate(language, 'go_to_anek'),
                        url: 'https://vk.com/wall' + message.from_id + '_' + message.post_id
                    });

                    if (!message.disableComments) {
                        buttons[buttons.length - 1].push({
                            text: dict.translate(language, 'comments'),
                            callback_data: 'comment ' + message.post_id
                        });
                    }
                }

                if (message.attachments && message.attachments.length > 0 && !message.forceAttachments) {
                    buttons.push([]);
                    buttons[buttons.length - 1].push({
                        text: dict.translate(language, 'attachments'),
                        callback_data: 'attach ' + message.post_id
                    })
                }

                return buttons;
            },
            editMessageButtons: function (message) {
                if (!message) {
                    return;
                }

                message.reply_markup = this.prepareButtons(message);

                return this.sendRequest('editMessageReplyMarkup', message).then(function (response) {
                    console.log(JSON.stringify(response));
                    return response;
                });
            },
            editMessage: function (message) {
                if (!message) {
                    return;
                }

                message.reply_markup = this.prepareButtons(message);

                return this.sendRequest('editMessageText', message).then(function (response) {
                    //console.log(JSON.stringify(response));
                    return response;
                });
            },
            sendMessage: function (userId, message, language) {
                if (!message) {
                    return;
                }

                if (message && message.copy_history && message.copy_history.length && message.post_id) {
                    var insideMessage = message.copy_history[0];
                    insideMessage.post_id = message.post_id;
                    insideMessage.from_id = message.from_id;
                    insideMessage.text = message.text + (message.text.length ? '\n' : '') + insideMessage.text;
                    return this.sendMessage(userId, insideMessage, language);
                }
                var sendMessage,
                    attachments = [];

                if (typeof message == 'string') {
                    sendMessage = {
                        chat_id: userId,
                        text: message
                    };
                } else {
                    var buttons = this.prepareButtons(message, language);

                    sendMessage = {
                        chat_id: userId,
                        text: message.text + ((message.attachments && message.attachments.length > 0) ? '\n(Вложений: ' + message.attachments.length + ')' : '')
                    };

                    if (buttons.length > 0) {
                        sendMessage.reply_markup = JSON.stringify({
                            inline_keyboard: buttons
                        });
                    }

                    if (message.forceAttachments) {
                        attachments = (message.attachments || []);
                    }
                }

                return this.sendRequest('sendMessage', sendMessage).then(function (response) {
                    return this.sendAttachments(userId, attachments).then(function () {
                        //console.log(JSON.stringify(response));
                        return response;
                    })
                }.bind(this));
            },
            sendMessages: function (userId, messages, language) {
                var messageQueue = new Queue(1, Infinity);
                return (messages || []).reduce(function (p, message) {
                    return p.then(messageQueue.add.bind(messageQueue, this.sendMessage.bind(this, userId, message, language)));
                }.bind(this), q.when());
            },
            sendMessageToAdmin: function (text) {
                return this.sendMessage(botConfig.adminChat, text);
            },
            getMe: function () {
                return this.sendRequest('getMe');
            },
            sendAttachments: function (userId, attachments) {
                var attachmentQueue = new Queue(1, Infinity);
                return (attachments || []).reduce(function (p, attachment) {
                    return p.then(attachmentQueue.add.bind(attachmentQueue, this.sendAttachment.bind(this, userId, attachment)));
                }.bind(this), q.when());
            },
            performAttachment: function (attachment) {
                if (!attachment) {
                    return undefined;
                }

                switch (attachment.type) {
                    case 'photo':
                        return {
                            command: 'sendPhoto',
                            sendAction: 'upload_photo',
                            photo: attachment.photo.photo_2560
                            || attachment.photo.photo_1280
                            || attachment.photo.photo_604
                            || attachment.photo.photo_130
                            || attachment.photo.photo_75,
                            caption: attachment.text
                        };
                        break;
                    /*case 'video':
                     return {
                     command: 'sendVideo',
                     video: 'https://vk.com/video' + attachment.video.owner_id + '_' + attachment.video.id,
                     caption: attachment.video.title
                     };
                     break;*/
                    case 'video':
                        return {
                            command: 'sendMessage',
                            sendAction: 'upload_video',
                            text: (attachment.title || '') + '\nhttps://vk.com/video' + attachment.video.owner_id + '_' + attachment.video.id
                        };
                        break;
                    case 'doc':
                        return {
                            command: 'sendDocument',
                            sendAction: 'upload_document',
                            document: attachment.doc.url,
                            caption: attachment.doc.title
                        };
                        break;
                    case 'audio':
                        return {
                            command: 'sendAudio',
                            type: 'audio',
                            sendAction: 'upload_audio',
                            useStream: true,
                            audio: attachment.audio.url,
                            title: attachment.audio.artist + ' - ' + attachment.audio.title
                        };
                        break;
                    case 'poll':
                        return {
                            command: 'sendMessage',
                            sendAction: 'typing',
                            text: 'Опрос: *' + attachment.poll.question + '*\n' + (attachment.poll.answers || []).map(function (answer, index) {
                                return  (index + 1) + ') ' + answer.text + ': ' + answer.votes + ' голоса (' + answer.rate + '%)'
                            }).join('\n'),
                            parse_mode: 'markdown'
                        };
                        break;
                    case 'link':
                        return {
                            command: 'sendMessage',
                            sendAction: 'typing',
                            text: attachment.link.title + '\n' + attachment.link.url
                        };
                        break;
                    default:
                        return undefined;
                        break;
                }
            }
        };

    Queue.configure(require('q').Promise);

    return botMethods;

};